const { query, withTransaction } = require("./db/pool");

let exerciseAssignmentsReady = false;

async function ensureExerciseAssignmentsTable() {
  if (exerciseAssignmentsReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS exercise_assignments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (patient_id, exercise_id)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS exercise_assignments_patient_idx
    ON exercise_assignments(patient_id, assigned_at DESC)
  `);
  exerciseAssignmentsReady = true;
}

function mapPatient(row) {
  return {
    id: row.id,
    therapistId: row.therapist_id,
    displayName: row.display_name,
    dateOfBirth: row.date_of_birth,
    dominantHand: row.dominant_hand,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalSessions: Number(row.total_sessions || 0),
    repsCompleted: Number(row.reps_completed || 0),
    bestFistScore: row.best_fist_score === null ? null : Number(row.best_fist_score)
  };
}

function mapSession(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    therapistId: row.therapist_id,
    gloveId: row.glove_id,
    exerciseId: row.exercise_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes
  };
}

function mapExerciseAssignment(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    exerciseId: row.exercise_id,
    assignedAt: row.assigned_at
  };
}

function mapGestureEvent(row) {
  const raw = row.raw || {};
  return {
    id: row.id,
    patientId: row.patient_id,
    sessionId: row.session_id,
    gloveId: row.glove_id,
    gesture: row.gesture,
    thumb: row.thumb,
    index: row.index_finger,
    middle: row.middle,
    ring: row.ring,
    pinky: row.pinky,
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    timestamp: row.recorded_at,
    createdAt: row.created_at,
    raw,
    rawValues: raw.rawValues || null
  };
}

async function ensureCalibrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS glove_calibrations (
      patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
      open JSONB NOT NULL,
      closed JSONB NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listPatients() {
  const result = await query(
    `
      SELECT
        p.*,
        COUNT(DISTINCT s.id) AS total_sessions,
        COALESCE(SUM(er.reps_completed), 0) AS reps_completed,
        MAX(CASE WHEN ge.gesture = 'fist' THEN ge.accuracy END) AS best_fist_score
      FROM patients p
      LEFT JOIN sessions s ON s.patient_id = p.id
      LEFT JOIN exercise_results er ON er.patient_id = p.id
      LEFT JOIN gesture_events ge ON ge.patient_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `
  );
  return result.rows.map(mapPatient);
}

async function createPatient(patient) {
  const result = await query(
    `
      INSERT INTO patients (id, therapist_id, display_name, date_of_birth, dominant_hand, notes)
      VALUES (COALESCE($1, 'patient-' || encode(gen_random_bytes(4), 'hex')), $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [patient.id, patient.therapistId, patient.displayName, patient.dateOfBirth, patient.dominantHand, patient.notes]
  );
  return mapPatient(result.rows[0]);
}

async function getPatient(id) {
  const result = await query("SELECT * FROM patients WHERE id = $1", [id]);
  return result.rows[0] ? mapPatient(result.rows[0]) : null;
}

async function listPatientSessions(patientId) {
  const result = await query(
    `
      SELECT s.*
      FROM sessions s
      WHERE s.patient_id = $1
      ORDER BY s.started_at DESC
    `,
    [patientId]
  );
  return result.rows.map(mapSession);
}

async function startSession(session) {
  const result = await query(
    `
      INSERT INTO sessions (patient_id, therapist_id, glove_id, exercise_id, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [session.patientId, session.therapistId, session.gloveId, session.exerciseId, session.notes]
  );
  return mapSession(result.rows[0]);
}

async function endSession(sessionId, payload) {
  return withTransaction(async (client) => {
    const sessionResult = await client.query(
      `
        UPDATE sessions
        SET status = 'ended', ended_at = now(), notes = COALESCE($2, notes)
        WHERE id = $1
        RETURNING *
      `,
      [sessionId, payload.notes]
    );

    if (sessionResult.rowCount === 0) return null;
    const session = sessionResult.rows[0];
    let exerciseResult = null;

    if (payload.exerciseResult) {
      const resultPayload = payload.exerciseResult;
      const result = await client.query(
        `
          INSERT INTO exercise_results (
            session_id, exercise_id, patient_id, reps_completed, successful_reps,
            best_accuracy, average_accuracy, hold_time_ms, smoothness, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `,
        [
          sessionId,
          resultPayload.exerciseId || session.exercise_id,
          session.patient_id,
          resultPayload.repsCompleted,
          resultPayload.successfulReps,
          resultPayload.bestAccuracy,
          resultPayload.averageAccuracy,
          resultPayload.holdTimeMs,
          resultPayload.smoothness,
          resultPayload.metadata
        ]
      );
      exerciseResult = result.rows[0];
    }

    return { session: mapSession(session), exerciseResult };
  });
}

async function findActiveSession(patientId) {
  const result = await query(
    `
      SELECT *
      FROM sessions
      WHERE patient_id = $1 AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [patientId]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

async function createGestureEvent(event) {
  const activeSession = event.sessionId ? null : await findActiveSession(event.patientId);
  const sessionId = event.sessionId || activeSession?.id || null;
  const recordedAt = event.timestamp || new Date();
  const rawPayload = {
    ...(event.raw || {}),
    ...(event.rawValues ? { rawValues: event.rawValues } : {})
  };

  const result = await query(
    `
      INSERT INTO gesture_events (
        patient_id, session_id, glove_id, gesture, thumb, index_finger, middle,
        ring, pinky, accuracy, raw, recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `,
    [
      event.patientId,
      sessionId,
      event.gloveId,
      event.gesture,
      event.thumb,
      event.index,
      event.middle,
      event.ring,
      event.pinky,
      event.accuracy,
      rawPayload,
      recordedAt
    ]
  );
  return mapGestureEvent(result.rows[0]);
}

async function getLatestGloveEvent() {
  const result = await query(
    `
      SELECT *
      FROM gesture_events
      WHERE raw ? 'rawValues'
      ORDER BY recorded_at DESC
      LIMIT 1
    `
  );

  return result.rows[0] ? mapGestureEvent(result.rows[0]) : null;
}

async function saveCalibration(patientId, data) {
  await ensureCalibrationTable();

  const result = await query(
    `
      INSERT INTO glove_calibrations (patient_id, open, closed, saved_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (patient_id)
      DO UPDATE SET open = EXCLUDED.open, closed = EXCLUDED.closed, saved_at = now()
      RETURNING patient_id, open, closed, saved_at
    `,
    [patientId, data.open, data.closed]
  );

  const row = result.rows[0];
  return {
    patientId: row.patient_id,
    open: row.open,
    closed: row.closed,
    savedAt: row.saved_at
  };
}

async function getCalibration(patientId) {
  await ensureCalibrationTable();

  const result = await query(
    `
      SELECT patient_id, open, closed, saved_at
      FROM glove_calibrations
      WHERE patient_id = $1
      LIMIT 1
    `,
    [patientId]
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    patientId: row.patient_id,
    open: row.open,
    closed: row.closed,
    savedAt: row.saved_at
  };
}

async function listSessionEvents(sessionId) {
  const result = await query(
    `
      SELECT *
      FROM gesture_events
      WHERE session_id = $1
      ORDER BY recorded_at ASC
    `,
    [sessionId]
  );
  return result.rows.map(mapGestureEvent);
}

async function listExercises() {
  const result = await query("SELECT * FROM exercises ORDER BY difficulty ASC, name ASC");
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    targetGesture: row.target_gesture,
    difficulty: row.difficulty,
    config: row.config,
    createdAt: row.created_at
  }));
}

async function createExercise(exercise) {
  const result = await query(
    `
      INSERT INTO exercises (name, description, target_gesture, difficulty, config)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [exercise.name, exercise.description, exercise.targetGesture, exercise.difficulty, exercise.config]
  );
  return result.rows[0];
}

async function createExerciseResult(payload) {
  const result = await query(
    `
      INSERT INTO exercise_results (
        session_id, exercise_id, patient_id, reps_completed, successful_reps,
        best_accuracy, average_accuracy, hold_time_ms, smoothness, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      payload.sessionId,
      payload.exerciseId,
      payload.patientId,
      payload.repsCompleted,
      payload.successfulReps,
      payload.bestAccuracy,
      payload.averageAccuracy,
      payload.holdTimeMs,
      payload.smoothness,
      payload.metadata
    ]
  );
  return result.rows[0];
}

async function listPatientExerciseAssignments(patientId) {
  await ensureExerciseAssignmentsTable();
  const result = await query(
    `
      SELECT *
      FROM exercise_assignments
      WHERE patient_id = $1
      ORDER BY assigned_at DESC
    `,
    [patientId]
  );
  return result.rows.map(mapExerciseAssignment);
}

async function createExerciseAssignment(payload) {
  await ensureExerciseAssignmentsTable();
  const assignedAt =
    payload.assignedAt instanceof Date
      ? payload.assignedAt.toISOString()
      : payload.assignedAt || new Date().toISOString();
  const result = await query(
    `
      INSERT INTO exercise_assignments (id, patient_id, exercise_id, assigned_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (patient_id, exercise_id)
      DO UPDATE SET assigned_at = EXCLUDED.assigned_at
      RETURNING *
    `,
    [
      payload.id || `exercise-assignment-${Date.now()}`,
      payload.patientId,
      payload.exerciseId,
      assignedAt
    ]
  );
  return mapExerciseAssignment(result.rows[0]);
}

async function deleteExerciseAssignment(id) {
  await ensureExerciseAssignmentsTable();
  const result = await query("DELETE FROM exercise_assignments WHERE id = $1 RETURNING id", [id]);
  return result.rowCount > 0;
}

async function getPatientProgress(patientId) {
  const result = await query(
    `
      WITH finger_stats AS (
        SELECT
          AVG(thumb) AS thumb,
          AVG(index_finger) AS index_finger,
          AVG(middle) AS middle,
          AVG(ring) AS ring,
          AVG(pinky) AS pinky
        FROM gesture_events
        WHERE patient_id = $1
      ),
      session_stats AS (
        SELECT
          COUNT(*) AS total_sessions,
          COALESCE(SUM(er.reps_completed), 0) AS reps_completed,
          MAX(er.best_accuracy) AS best_accuracy,
          AVG(er.average_accuracy) AS average_accuracy
        FROM sessions s
        LEFT JOIN exercise_results er ON er.session_id = s.id
        WHERE s.patient_id = $1
      ),
      recent_mobility AS (
        SELECT
          date_trunc('day', recorded_at) AS day,
          AVG((thumb + index_finger + middle + ring + pinky) / 5.0) AS average_bend
        FROM gesture_events
        WHERE patient_id = $1
        GROUP BY day
        ORDER BY day ASC
      )
      SELECT
        (SELECT row_to_json(session_stats) FROM session_stats) AS session_stats,
        (SELECT row_to_json(finger_stats) FROM finger_stats) AS finger_stats,
        COALESCE((SELECT json_agg(recent_mobility) FROM recent_mobility), '[]'::json) AS mobility
    `,
    [patientId]
  );

  const row = result.rows[0];
  const fingerStats = row.finger_stats || {};
  const fingerEntries = Object.entries(fingerStats).filter(([, value]) => value !== null);
  const weakestFinger = fingerEntries.sort((a, b) => Number(a[1]) - Number(b[1]))[0]?.[0] || null;

  return {
    sessionStats: row.session_stats,
    fingerStats,
    weakestFinger,
    mobilityOverTime: row.mobility
  };
}

async function createOrGetTherapist(authUserId, email, name) {
  const result = await query(
    `
      INSERT INTO therapists (auth_user_id, email, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (auth_user_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING *
    `,
    [authUserId, email, name || email]
  );
  return result.rows[0];
}

module.exports = {
  listPatients,
  createPatient,
  getPatient,
  listPatientSessions,
  startSession,
  endSession,
  createGestureEvent,
  getLatestGloveEvent,
  saveCalibration,
  getCalibration,
  listSessionEvents,
  listExercises,
  createExercise,
  createExerciseResult,
  listPatientExerciseAssignments,
  createExerciseAssignment,
  deleteExerciseAssignment,
  getPatientProgress,
  createOrGetTherapist
};
