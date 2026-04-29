const { randomUUID } = require("crypto");

const fingerNames = ["thumb", "index", "middle", "ring", "pinky"];

function iso(date) {
  return date.toISOString();
}

function daysAgo(days, hour = 14, minute = 30) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function daysFromNow(days, hour = 10, minute = 0) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const doctor = {
  id: "doctor-1",
  userId: "user-doctor-1",
  name: "Dr. Singh",
  email: "dr.singh@dextera.demo",
  specialty: "Physiotherapist"
};

const games = [
  {
    id: "ball-pickup",
    name: "Ball Pickup",
    description: "Pick up balls with a fist gesture and release into a basket with an open hand.",
    targetSkills: ["grip control", "release control", "hand-eye coordination", "finger flexion", "finger extension"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "medium",
    route: "/vr"
  },
  {
    id: "finger-tap-piano",
    name: "Finger Tap Piano",
    description: "Tap individual fingers in rhythm to improve isolation and timing.",
    targetSkills: ["finger isolation", "timing", "dexterity", "coordination"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "easy",
    route: "/games/finger-tap-piano"
  },
  {
    id: "bubble-pop",
    name: "Bubble Pop",
    description: "Point and reach to pop targets as they appear.",
    targetSkills: ["reach", "pointing", "reaction time", "hand-eye coordination"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "easy",
    route: "/games/bubble-pop"
  },
  {
    id: "carrom-flick",
    name: "Carrom Flick",
    description: "Practice controlled finger extension and flick precision.",
    targetSkills: ["finger extension", "flick control", "aim", "force control", "precision"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "medium",
    route: "/games/carrom-flick"
  }
];

const patientRows = [
  {
    id: "patient-1",
    userId: "user-patient-1",
    doctorId: doctor.id,
    name: "Maya Patel",
    age: 52,
    condition: "Stroke hand rehabilitation",
    recoveryGoal: "Improve right-hand grip and release control",
    affectedHand: "right",
    status: "improving",
    notes: "Focus on fully opening hand before releasing objects.",
    createdAt: iso(daysAgo(35))
  },
  {
    id: "patient-2",
    userId: "user-patient-2",
    doctorId: doctor.id,
    name: "Daniel Lee",
    age: 34,
    condition: "Post-injury hand therapy",
    recoveryGoal: "Improve finger extension and controlled grip",
    affectedHand: "left",
    status: "low_adherence",
    notes: "Prefers shorter sessions. Review pain report before raising difficulty.",
    createdAt: iso(daysAgo(28))
  },
  {
    id: "patient-3",
    userId: "user-patient-3",
    doctorId: doctor.id,
    name: "Amira Khan",
    age: 46,
    condition: "Fine motor recovery",
    recoveryGoal: "Improve finger isolation and coordination",
    affectedHand: "right",
    status: "stable",
    notes: "Piano-style finger taps are useful for engagement.",
    createdAt: iso(daysAgo(24))
  }
];

const assignments = [
  {
    id: "assignment-maya-ball",
    patientId: "patient-1",
    doctorId: doctor.id,
    gameId: "ball-pickup",
    gameName: "Ball Pickup",
    difficulty: "medium",
    reps: 10,
    rounds: null,
    frequency: "daily",
    dueDate: todayIso(),
    targetSkill: "grip and release control",
    notes: "Use demo simulator or smart glove. Prioritize clean release.",
    status: "assigned",
    createdAt: iso(daysAgo(7)),
    updatedAt: iso(daysAgo(1))
  },
  {
    id: "assignment-maya-piano",
    patientId: "patient-1",
    doctorId: doctor.id,
    gameId: "finger-tap-piano",
    gameName: "Finger Tap Piano",
    difficulty: "easy",
    reps: null,
    rounds: 3,
    frequency: "3x/week",
    dueDate: iso(daysFromNow(2)).slice(0, 10),
    targetSkill: "finger isolation and timing",
    notes: "Watch ring finger independence.",
    status: "assigned",
    createdAt: iso(daysAgo(5)),
    updatedAt: iso(daysAgo(1))
  },
  {
    id: "assignment-daniel-bubble",
    patientId: "patient-2",
    doctorId: doctor.id,
    gameId: "bubble-pop",
    gameName: "Bubble Pop",
    difficulty: "easy",
    reps: null,
    rounds: 2,
    frequency: "daily",
    dueDate: iso(daysAgo(2)).slice(0, 10),
    targetSkill: "reach and reaction time",
    notes: "Missed target date. Review adherence.",
    status: "assigned",
    createdAt: iso(daysAgo(8)),
    updatedAt: iso(daysAgo(2))
  },
  {
    id: "assignment-amira-carrom",
    patientId: "patient-3",
    doctorId: doctor.id,
    gameId: "carrom-flick",
    gameName: "Carrom Flick",
    difficulty: "medium",
    reps: 5,
    rounds: null,
    frequency: "2x/week",
    dueDate: iso(daysFromNow(4)).slice(0, 10),
    targetSkill: "finger extension and precision",
    notes: "Keep movements controlled before increasing force.",
    status: "assigned",
    createdAt: iso(daysAgo(4)),
    updatedAt: iso(daysAgo(1))
  }
];

const sessions = [];
const gestureEvents = [];
let latestGloveEvent = null;
const calibrations = new Map();

function addSession({
  id = randomUUID(),
  patientId,
  assignmentId,
  gameId,
  gameName,
  days,
  repsRequired,
  repsCompleted,
  successfulReps,
  failedAttempts,
  accuracy,
  score,
  inputMode,
  painBefore,
  painAfter,
  fatigueBefore,
  fatigueAfter,
  weakestFinger,
  notes
}) {
  const startedAt = daysAgo(days, 15, 15);
  const endedAt = new Date(startedAt.getTime() + 9 * 60 * 1000);
  const session = {
    id,
    patientId,
    assignmentId,
    gameId,
    gameName,
    startedAt: iso(startedAt),
    endedAt: iso(endedAt),
    repsRequired,
    repsCompleted,
    successfulReps,
    failedAttempts,
    accuracy,
    timeTaken: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    score,
    inputMode,
    painBefore,
    painAfter,
    fatigueBefore,
    fatigueAfter,
    weakestFinger,
    notes
  };
  sessions.push(session);

  const gestures = ["point", "fist", "open"];
  for (let index = 0; index < Math.max(3, repsCompleted * 3); index += 1) {
    const gesture = gestures[index % gestures.length];
    const base = gesture === "fist" ? 82 : gesture === "open" ? 12 : 55;
    gestureEvents.push({
      id: randomUUID(),
      sessionId: id,
      patientId,
      gesture,
      thumb: clampPercent(base + (index % 5) * 2),
      index: clampPercent((gesture === "point" ? 10 : base) + (index % 3) * 2),
      middle: clampPercent(base + (index % 4)),
      ring: clampPercent(base - (weakestFinger === "ring" ? 18 : 0)),
      pinky: clampPercent(base - (weakestFinger === "pinky" ? 14 : 0)),
      handX: Number((0.15 + (index % 8) * 0.09).toFixed(3)),
      handY: Number((0.25 + (index % 6) * 0.08).toFixed(3)),
      handZ: Number((0.3 + (index % 3) * 0.1).toFixed(3)),
      accuracy: clampPercent(accuracy + ((index % 5) - 2)),
      timestamp: iso(new Date(startedAt.getTime() + index * 18_000)),
      createdAt: iso(new Date(startedAt.getTime() + index * 18_000 + 500))
    });
  }
}

addSession({
  patientId: "patient-1",
  assignmentId: "assignment-maya-ball",
  gameId: "ball-pickup",
  gameName: "Ball Pickup",
  days: 12,
  repsRequired: 10,
  repsCompleted: 7,
  successfulReps: 6,
  failedAttempts: 2,
  accuracy: 62,
  score: 620,
  inputMode: "demo",
  painBefore: 2,
  painAfter: 3,
  fatigueBefore: 2,
  fatigueAfter: 3,
  weakestFinger: "ring",
  notes: "Early grip-release work. Release timing inconsistent."
});
addSession({ patientId: "patient-1", assignmentId: "assignment-maya-ball", gameId: "ball-pickup", gameName: "Ball Pickup", days: 8, repsRequired: 10, repsCompleted: 8, successfulReps: 8, failedAttempts: 1, accuracy: 71, score: 710, inputMode: "glove", painBefore: 2, painAfter: 3, fatigueBefore: 3, fatigueAfter: 4, weakestFinger: "ring", notes: "Improved grip strength." });
addSession({ patientId: "patient-1", assignmentId: "assignment-maya-ball", gameId: "ball-pickup", gameName: "Ball Pickup", days: 5, repsRequired: 10, repsCompleted: 9, successfulReps: 8, failedAttempts: 1, accuracy: 76, score: 760, inputMode: "glove", painBefore: 2, painAfter: 3, fatigueBefore: 3, fatigueAfter: 4, weakestFinger: "ring", notes: "Cleaner release phase." });
addSession({ patientId: "patient-1", assignmentId: "assignment-maya-piano", gameId: "finger-tap-piano", gameName: "Finger Tap Piano", days: 3, repsRequired: 3, repsCompleted: 3, successfulReps: 3, failedAttempts: 0, accuracy: 78, score: 780, inputMode: "camera", painBefore: 1, painAfter: 2, fatigueBefore: 2, fatigueAfter: 3, weakestFinger: "ring", notes: "Ring finger isolation still limited." });
addSession({ patientId: "patient-1", assignmentId: "assignment-maya-ball", gameId: "ball-pickup", gameName: "Ball Pickup", days: 1, repsRequired: 10, repsCompleted: 10, successfulReps: 9, failedAttempts: 1, accuracy: 80, score: 820, inputMode: "demo", painBefore: 2, painAfter: 3, fatigueBefore: 3, fatigueAfter: 4, weakestFinger: "ring", notes: "Demo-ready progression." });
addSession({ patientId: "patient-2", assignmentId: "assignment-daniel-bubble", gameId: "bubble-pop", gameName: "Bubble Pop", days: 9, repsRequired: 2, repsCompleted: 1, successfulReps: 1, failedAttempts: 4, accuracy: 55, score: 310, inputMode: "camera", painBefore: 2, painAfter: 6, fatigueBefore: 3, fatigueAfter: 6, weakestFinger: "index", notes: "Pain increased after session." });
addSession({ patientId: "patient-2", assignmentId: "assignment-daniel-bubble", gameId: "bubble-pop", gameName: "Bubble Pop", days: 6, repsRequired: 2, repsCompleted: 1, successfulReps: 1, failedAttempts: 3, accuracy: 58, score: 350, inputMode: "demo", painBefore: 7, painAfter: 8, fatigueBefore: 5, fatigueAfter: 7, weakestFinger: "index", notes: "High pain before session. Needs review." });
addSession({ patientId: "patient-3", assignmentId: "assignment-amira-carrom", gameId: "carrom-flick", gameName: "Carrom Flick", days: 10, repsRequired: 5, repsCompleted: 4, successfulReps: 3, failedAttempts: 2, accuracy: 68, score: 540, inputMode: "demo", painBefore: 1, painAfter: 2, fatigueBefore: 2, fatigueAfter: 3, weakestFinger: "pinky", notes: "Force control developing." });
addSession({ patientId: "patient-3", assignmentId: "assignment-amira-carrom", gameId: "carrom-flick", gameName: "Carrom Flick", days: 4, repsRequired: 5, repsCompleted: 5, successfulReps: 4, failedAttempts: 1, accuracy: 73, score: 690, inputMode: "camera", painBefore: 1, painAfter: 1, fatigueBefore: 2, fatigueAfter: 3, weakestFinger: "pinky", notes: "Better aim consistency." });
addSession({ patientId: "patient-3", assignmentId: "assignment-amira-carrom", gameId: "carrom-flick", gameName: "Carrom Flick", days: 2, repsRequired: 5, repsCompleted: 5, successfulReps: 5, failedAttempts: 0, accuracy: 77, score: 750, inputMode: "glove", painBefore: 1, painAfter: 2, fatigueBefore: 2, fatigueAfter: 3, weakestFinger: "pinky", notes: "Stable progress." });

const appointments = [
  {
    id: "appointment-maya",
    patientId: "patient-1",
    doctorId: doctor.id,
    date: iso(daysFromNow(3)).slice(0, 10),
    time: "10:30",
    type: "Progress check-in",
    notes: "Review Ball Pickup release timing.",
    status: "scheduled",
    createdAt: iso(daysAgo(1))
  },
  {
    id: "appointment-daniel",
    patientId: "patient-2",
    doctorId: doctor.id,
    date: iso(daysFromNow(1)).slice(0, 10),
    time: "14:00",
    type: "Pain/fatigue review",
    notes: "Discuss adherence and pain increase.",
    status: "scheduled",
    createdAt: iso(daysAgo(1))
  }
];

function completedAssignmentIds(patientId) {
  return new Set(
    sessions
      .filter((session) => session.patientId === patientId && session.endedAt && session.successfulReps > 0)
      .map((session) => session.assignmentId)
  );
}

function detectWeakestFinger(items) {
  const sessionsInput = items.filter((item) => item.weakestFinger);
  if (sessionsInput.length) {
    const counts = sessionsInput.reduce((acc, session) => {
      acc[session.weakestFinger] = (acc[session.weakestFinger] || 0) + 1;
      return acc;
    }, {});
    const [weakestFinger, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ["ring", 0];
    return {
      weakestFinger,
      confidence: sessionsInput.length ? Number((count / sessionsInput.length).toFixed(2)) : 0,
      message: `${titleCase(weakestFinger)} finger performance was lowest across recent sessions.`
    };
  }

  const events = items.filter((item) => typeof item.thumb === "number");
  if (!events.length) {
    return { weakestFinger: "ring", confidence: 0, message: "Not enough event data yet." };
  }
  const averages = fingerNames.map((finger) => ({
    finger,
    value: events.reduce((sum, event) => sum + Number(event[finger] || 0), 0) / events.length
  }));
  const weakest = averages.sort((a, b) => a.value - b.value)[0];
  return {
    weakestFinger: weakest.finger,
    confidence: 0.65,
    message: `${titleCase(weakest.finger)} finger performance was lowest across gesture events.`
  };
}

function getPatientSessions(patientId) {
  return sessions
    .filter((session) => session.patientId === patientId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function getPatientAssignments(patientId) {
  const completed = completedAssignmentIds(patientId);
  return assignments
    .filter((assignment) => assignment.patientId === patientId)
    .map((assignment) => {
      const missed = assignment.status === "assigned" && assignment.dueDate < todayIso() && !completed.has(assignment.id);
      return { ...assignment, status: missed ? "missed" : assignment.status };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function getWeeklyCompletionRate(patientId) {
  const patientAssignments = getPatientAssignments(patientId);
  if (!patientAssignments.length) return 0;
  const patient = patientRows.find((row) => row.id === patientId);
  if (patient?.status === "low_adherence" || patientAssignments.some((assignment) => assignment.status === "missed")) {
    return 25;
  }
  const completed = patientAssignments.filter((assignment) =>
    sessions.some((session) => session.assignmentId === assignment.id && session.endedAt)
  ).length;
  return Math.round((completed / patientAssignments.length) * 100);
}

function getAverageAccuracy(patientId) {
  const patientSessions = getPatientSessions(patientId);
  if (!patientSessions.length) return 0;
  return clampPercent(patientSessions.reduce((sum, session) => sum + session.accuracy, 0) / patientSessions.length);
}

function getLatestAccuracy(patientId) {
  return getPatientSessions(patientId)[0]?.accuracy || 0;
}

function getImprovementPercent(patientId) {
  const ordered = getPatientSessions(patientId).slice().reverse();
  if (ordered.length < 2) return 0;
  return clampPercent(ordered[ordered.length - 1].accuracy - ordered[0].accuracy);
}

function generateAlerts(patientId) {
  const patient = patientRows.find((row) => row.id === patientId);
  if (!patient) return [];
  const patientAssignments = getPatientAssignments(patientId);
  const patientSessions = getPatientSessions(patientId);
  const alerts = [];

  for (const assignment of patientAssignments) {
    if (assignment.status === "missed") {
      alerts.push({
        id: `missed-${assignment.id}`,
        patientId,
        type: "missed_session",
        severity: "medium",
        title: "Missed session",
        message: `${patient.name} missed ${assignment.gameName} on ${assignment.dueDate}.`,
        createdAt: new Date().toISOString(),
        resolved: false
      });
    }
  }

  for (const session of patientSessions.slice(0, 5)) {
    const painDelta = Number(session.painAfter || 0) - Number(session.painBefore || 0);
    const fatigueDelta = Number(session.fatigueAfter || 0) - Number(session.fatigueBefore || 0);
    if (painDelta >= 3 || session.painBefore >= 7) {
      alerts.push({
        id: `pain-${session.id}`,
        patientId,
        type: "pain_increase",
        severity: painDelta >= 5 || session.painBefore >= 7 ? "high" : "medium",
        title: session.painBefore >= 7 ? "High starting pain" : "Pain increased",
        message: `${patient.name} reported pain ${session.painBefore}/10 to ${session.painAfter}/10 after ${session.gameName}.`,
        createdAt: session.endedAt || session.startedAt,
        resolved: false
      });
    }
    if (fatigueDelta >= 3 || session.fatigueBefore >= 7) {
      alerts.push({
        id: `fatigue-${session.id}`,
        patientId,
        type: "fatigue_increase",
        severity: fatigueDelta >= 5 || session.fatigueBefore >= 7 ? "high" : "medium",
        title: session.fatigueBefore >= 7 ? "High starting fatigue" : "Fatigue increased",
        message: `${patient.name} reported fatigue ${session.fatigueBefore}/10 to ${session.fatigueAfter}/10 after ${session.gameName}.`,
        createdAt: session.endedAt || session.startedAt,
        resolved: false
      });
    }
  }

  const weakest = detectWeakestFinger(patientSessions.slice(0, 5));
  if (weakest.confidence >= 0.5) {
    alerts.push({
      id: `weak-${patientId}-${weakest.weakestFinger}`,
      patientId,
      type: "weak_finger",
      severity: weakest.confidence >= 0.7 ? "medium" : "low",
      title: `${titleCase(weakest.weakestFinger)} finger weakness`,
      message: weakest.message,
      createdAt: new Date().toISOString(),
      resolved: false
    });
  }

  const adherence = getWeeklyCompletionRate(patientId);
  if (adherence < 50) {
    alerts.push({
      id: `adherence-${patientId}`,
      patientId,
      type: "low_adherence",
      severity: "high",
      title: "Low adherence",
      message: `${patient.name} completed ${adherence}% of assigned sessions in the current plan.`,
      createdAt: new Date().toISOString(),
      resolved: false
    });
  }

  return alerts;
}

function difficultyRecommendation(patientId) {
  const patient = patientRows.find((row) => row.id === patientId);
  const patientSessions = getPatientSessions(patientId);
  const latest = patientSessions[0];
  const latestTwo = patientSessions.slice(0, 2);
  const adherence = getWeeklyCompletionRate(patientId);

  if (latestTwo.length >= 2 && latestTwo.every((session) => session.accuracy >= 90)) {
    return {
      patientId,
      recommendation: "Consider increasing difficulty",
      reason: "Accuracy has been above 90% for two sessions.",
      label: "Clinician must approve changes."
    };
  }
  if (latest && latest.accuracy < 60) {
    return {
      patientId,
      recommendation: "Consider lowering difficulty",
      reason: "Accuracy was below 60%.",
      label: "Clinician must approve changes."
    };
  }
  if (latest && latest.painAfter - latest.painBefore >= 3) {
    return {
      patientId,
      recommendation: "Keep or lower difficulty",
      reason: `Pain increased by ${latest.painAfter - latest.painBefore} points after the latest session.`,
      label: "Clinician must approve changes."
    };
  }
  if (adherence < 50 || patient?.status === "low_adherence") {
    return {
      patientId,
      recommendation: "Consider shorter or easier exercises",
      reason: "Adherence is low.",
      label: "Clinician must approve changes."
    };
  }
  return {
    patientId,
    recommendation: "Continue current difficulty",
    reason: "Patient is progressing steadily.",
    label: "Clinician must approve changes."
  };
}

function progressSummary(patientId) {
  const patientSessions = getPatientSessions(patientId);
  const weakest = detectWeakestFinger(patientSessions.slice(0, 5));
  return {
    patientId,
    weeklyCompletionRate: getWeeklyCompletionRate(patientId),
    averageAccuracy: getAverageAccuracy(patientId),
    latestAccuracy: getLatestAccuracy(patientId),
    weakestFinger: weakest.weakestFinger,
    painTrend: patientSessions[0] ? `${patientSessions[0].painBefore} -> ${patientSessions[0].painAfter}` : "No sessions",
    fatigueTrend: patientSessions[0] ? `${patientSessions[0].fatigueBefore} -> ${patientSessions[0].fatigueAfter}` : "No sessions",
    improvementPercent: getImprovementPercent(patientId),
    recommendation: difficultyRecommendation(patientId).recommendation
  };
}

function mapPatient(row) {
  const patientSessions = getPatientSessions(row.id);
  const weakest = detectWeakestFinger(patientSessions.slice(0, 5));
  return {
    ...row,
    displayName: row.name,
    dominantHand: row.affectedHand,
    totalSessions: patientSessions.length,
    repsCompleted: patientSessions.reduce((sum, session) => sum + Number(session.repsCompleted || 0), 0),
    bestFistScore: patientSessions.reduce((best, session) => Math.max(best, Number(session.accuracy || 0)), 0),
    latestAccuracy: getLatestAccuracy(row.id),
    adherence: getWeeklyCompletionRate(row.id),
    weakestFinger: weakest.weakestFinger,
    activeAlerts: generateAlerts(row.id).filter((alert) => !alert.resolved).length
  };
}

async function healthCheck() {
  return { ok: true, storage: "mock" };
}

async function listPatients() {
  return patientRows.map(mapPatient);
}

async function createPatient(patient) {
  const stored = {
    id: patient.id || `patient-${randomUUID().slice(0, 8)}`,
    userId: `user-${randomUUID().slice(0, 8)}`,
    doctorId: patient.therapistId || doctor.id,
    name: patient.displayName,
    age: 0,
    condition: patient.notes || "Hand rehabilitation",
    recoveryGoal: patient.notes || "Improve hand mobility",
    affectedHand: patient.dominantHand === "unknown" ? "right" : patient.dominantHand,
    status: "stable",
    notes: patient.notes || "",
    createdAt: new Date().toISOString()
  };
  patientRows.push(stored);
  return mapPatient(stored);
}

async function getPatient(id) {
  const row = patientRows.find((patient) => patient.id === id);
  return row ? mapPatient(row) : null;
}

async function updatePatientNotes(patientId, notes) {
  const patient = patientRows.find((row) => row.id === patientId);
  if (!patient) return null;
  patient.notes = notes;
  return mapPatient(patient);
}

async function listPatientSessions(patientId) {
  return getPatientSessions(patientId);
}

async function getSession(sessionId) {
  return sessions.find((session) => session.id === sessionId) || null;
}

async function startSession(session) {
  const assignment = assignments.find((item) => item.id === session.assignmentId);
  const game = games.find((item) => item.id === (session.gameId || assignment?.gameId));
  const stored = {
    id: randomUUID(),
    patientId: session.patientId,
    assignmentId: session.assignmentId || assignment?.id || null,
    gameId: session.gameId || assignment?.gameId || game?.id || "ball-pickup",
    gameName: session.gameName || assignment?.gameName || game?.name || "Ball Pickup",
    startedAt: new Date().toISOString(),
    endedAt: null,
    repsRequired: assignment?.reps || assignment?.rounds || 0,
    repsCompleted: 0,
    successfulReps: 0,
    failedAttempts: 0,
    accuracy: 0,
    timeTaken: 0,
    score: 0,
    inputMode: session.inputMode || "demo",
    painBefore: session.painBefore || 0,
    painAfter: null,
    fatigueBefore: session.fatigueBefore || 0,
    fatigueAfter: null,
    weakestFinger: null,
    notes: session.notes || ""
  };
  sessions.unshift(stored);
  return { ...stored };
}

async function endSession(sessionId, payload) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  const exerciseResult = payload.exerciseResult || {};
  session.endedAt = new Date().toISOString();
  session.notes = payload.notes || session.notes;
  session.repsRequired = payload.repsRequired ?? exerciseResult.metadata?.targetReps ?? session.repsRequired;
  session.repsCompleted = payload.repsCompleted ?? exerciseResult.repsCompleted ?? session.repsCompleted;
  session.successfulReps = payload.successfulReps ?? exerciseResult.successfulReps ?? session.successfulReps;
  session.failedAttempts = payload.failedAttempts ?? Math.max(0, session.repsCompleted - session.successfulReps);
  session.accuracy = clampPercent(payload.accuracy ?? exerciseResult.averageAccuracy ?? session.accuracy);
  session.timeTaken = payload.timeTaken ?? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000);
  session.score = payload.score ?? session.accuracy * Math.max(1, session.successfulReps);
  session.painAfter = payload.painAfter ?? session.painAfter ?? session.painBefore;
  session.fatigueAfter = payload.fatigueAfter ?? session.fatigueAfter ?? session.fatigueBefore;
  session.weakestFinger = payload.weakestFinger || detectWeakestFinger(gestureEvents.filter((event) => event.sessionId === sessionId)).weakestFinger;

  const assignment = assignments.find((item) => item.id === session.assignmentId);
  if (assignment && session.successfulReps >= Math.max(1, Math.ceil((assignment.reps || assignment.rounds || 1) * 0.8))) {
    assignment.status = "completed";
    assignment.updatedAt = new Date().toISOString();
  }

  return { session: { ...session }, exerciseResult: { ...session } };
}

function findActiveSession(patientId) {
  return sessions.find((session) => session.patientId === patientId && !session.endedAt);
}

async function createGestureEvent(event) {
  const activeSession = event.sessionId ? null : findActiveSession(event.patientId);
  const stored = {
    id: randomUUID(),
    patientId: event.patientId,
    sessionId: event.sessionId || activeSession?.id || null,
    gloveId: event.gloveId || null,
    gesture: event.gesture || "unknown",
    thumb: event.thumb,
    index: event.index,
    middle: event.middle,
    ring: event.ring,
    pinky: event.pinky,
    handX: event.handX,
    handY: event.handY,
    handZ: event.handZ,
    accuracy: clampPercent(event.accuracy || 75),
    timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : event.timestamp || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    rawValues: event.rawValues || null,
    raw: event.raw || event
  };
  gestureEvents.push(stored);
  if (event.rawValues) {
    latestGloveEvent = { ...stored };
  }
  return { ...stored };
}

async function listSessionEvents(sessionId) {
  return gestureEvents
    .filter((event) => event.sessionId === sessionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function listExercises() {
  return games.map((game, index) => ({
    id: game.id,
    name: game.name,
    description: game.description,
    targetGesture: index === 1 ? "tap_index" : index === 2 ? "point" : index === 3 ? "flick" : "fist",
    difficulty: game.defaultDifficulty === "hard" ? 3 : game.defaultDifficulty === "medium" ? 2 : 1,
    config: { targetSkills: game.targetSkills, route: game.route },
    createdAt: patientRows[0].createdAt
  }));
}

async function createExercise(exercise) {
  const stored = {
    id: exercise.id || `game-${randomUUID().slice(0, 8)}`,
    name: exercise.name,
    description: exercise.description || "",
    targetSkills: exercise.config?.targetSkills || [],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: exercise.difficulty > 2 ? "hard" : exercise.difficulty > 1 ? "medium" : "easy",
    route: exercise.config?.route || ""
  };
  games.push(stored);
  return stored;
}

async function createExerciseResult(payload) {
  const session = sessions.find((item) => item.id === payload.sessionId);
  if (session) {
    session.repsCompleted = payload.repsCompleted;
    session.successfulReps = payload.successfulReps;
    session.accuracy = payload.averageAccuracy || payload.bestAccuracy || session.accuracy;
  }
  return { id: randomUUID(), ...payload, createdAt: new Date().toISOString() };
}

async function getPatientProgress(patientId) {
  const patientSessions = getPatientSessions(patientId);
  const events = gestureEvents.filter((event) => event.patientId === patientId);
  const fingerStats = fingerNames.reduce((stats, finger) => {
    stats[finger === "index" ? "index_finger" : finger] = events.length
      ? events.reduce((sum, event) => sum + Number(event[finger] || 0), 0) / events.length
      : null;
    return stats;
  }, {});
  return {
    sessionStats: {
      total_sessions: patientSessions.length,
      reps_completed: patientSessions.reduce((sum, session) => sum + session.repsCompleted, 0),
      best_accuracy: patientSessions.reduce((best, session) => Math.max(best, session.accuracy), 0),
      average_accuracy: getAverageAccuracy(patientId)
    },
    fingerStats,
    weakestFinger: detectWeakestFinger(patientSessions).weakestFinger,
    mobilityOverTime: patientSessions.slice().reverse().map((session) => ({
      day: session.startedAt,
      average_bend: session.accuracy
    }))
  };
}

async function listPatientAssignments(patientId) {
  return getPatientAssignments(patientId);
}

async function createAssignment(payload) {
  const stored = {
    id: `assignment-${randomUUID().slice(0, 8)}`,
    ...payload,
    status: payload.status || "assigned",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  assignments.unshift(stored);
  return { ...stored };
}

async function updateAssignment(id, patch) {
  const assignment = assignments.find((item) => item.id === id);
  if (!assignment) return null;
  Object.assign(assignment, patch, { updatedAt: new Date().toISOString() });
  return { ...assignment };
}

async function deleteAssignment(id) {
  const index = assignments.findIndex((item) => item.id === id);
  if (index === -1) return false;
  assignments.splice(index, 1);
  return true;
}

async function listPatientAppointments(patientId) {
  return appointments
    .filter((appointment) => appointment.patientId === patientId)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

async function listAppointments() {
  return appointments.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

async function createAppointment(payload) {
  const stored = {
    id: `appointment-${randomUUID().slice(0, 8)}`,
    ...payload,
    status: payload.status || "scheduled",
    createdAt: new Date().toISOString()
  };
  appointments.unshift(stored);
  return { ...stored };
}

async function updateAppointment(id, patch) {
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return null;
  Object.assign(appointment, patch);
  return { ...appointment };
}

async function listPatientAlerts(patientId) {
  return generateAlerts(patientId);
}

async function listAlerts() {
  return patientRows.flatMap((patient) => generateAlerts(patient.id));
}

async function getDifficultyRecommendation(patientId) {
  return difficultyRecommendation(patientId);
}

async function getAnalytics(patientId) {
  const patientSessions = getPatientSessions(patientId).slice().reverse();
  return {
    summary: progressSummary(patientId),
    accuracyTrend: patientSessions.map((session) => ({ date: session.startedAt.slice(0, 10), accuracy: session.accuracy })),
    sessionsPerWeek: [{ label: "This week", sessions: patientSessions.filter((session) => Date.now() - new Date(session.startedAt).getTime() < 7 * 24 * 60 * 60 * 1000).length }],
    repsTrend: patientSessions.map((session) => ({ date: session.startedAt.slice(0, 10), repsCompleted: session.repsCompleted })),
    painFatigueTrend: patientSessions.map((session) => ({
      date: session.startedAt.slice(0, 10),
      painBefore: session.painBefore,
      painAfter: session.painAfter,
      fatigueBefore: session.fatigueBefore,
      fatigueAfter: session.fatigueAfter
    })),
    weakestFinger: detectWeakestFinger(getPatientSessions(patientId))
  };
}

async function createProgressSummary(patientId) {
  const patient = patientRows.find((row) => row.id === patientId);
  if (!patient) return null;
  const analytics = progressSummary(patientId);
  const recommendation = difficultyRecommendation(patientId);
  const summary = `${patient.name} completed ${analytics.weeklyCompletionRate}% of assigned sessions in the current plan. Latest accuracy is ${analytics.latestAccuracy}% with ${analytics.improvementPercent}% improvement from the first recorded session. ${titleCase(analytics.weakestFinger)} finger remains the weakest area. Pain trend is ${analytics.painTrend} and fatigue trend is ${analytics.fatigueTrend}. ${recommendation.recommendation}: ${recommendation.reason} Clinician review recommended.`;
  return { patientId, summary, generatedAt: new Date().toISOString() };
}

async function getLatestGloveEvent() {
  return latestGloveEvent;
}

async function saveCalibration(patientId, data) {
  calibrations.set(patientId, { ...data, savedAt: new Date().toISOString() });
  return calibrations.get(patientId);
}

async function getCalibration(patientId) {
  return calibrations.get(patientId) || null;
}

async function createOrGetTherapist(authUserId, email, name) {
  return { ...doctor, userId: authUserId || doctor.userId, email: email || doctor.email, name: name || doctor.name };
}

module.exports = {
  healthCheck,
  listPatients,
  createPatient,
  getPatient,
  updatePatientNotes,
  listPatientSessions,
  getSession,
  startSession,
  endSession,
  createGestureEvent,
  listSessionEvents,
  listExercises,
  createExercise,
  createExerciseResult,
  getPatientProgress,
  listPatientAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listPatientAppointments,
  listAppointments,
  createAppointment,
  updateAppointment,
  listPatientAlerts,
  listAlerts,
  getDifficultyRecommendation,
  getAnalytics,
  createProgressSummary,
  createOrGetTherapist,
  getLatestGloveEvent,
  saveCalibration,
  getCalibration
};
