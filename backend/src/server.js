const http = require("http");
const cors = require("cors");
const express = require("express");
const { config } = require("./config");
const { createRealtimeServer } = require("./realtime");
const { fakeGestureEvent } = require("./fakeGesture");
const { requireAuth } = require("./middleware/auth");
const {
  gestureEventSchema,
  createPatientSchema,
  startSessionSchema,
  endSessionSchema,
  createExerciseSchema,
  exerciseResultSchema,
  assignmentSchema,
  exerciseAssignmentSchema,
  appointmentSchema,
  progressSummarySchema,
  updatePatientNotesSchema
} = require("./validation");

const usingPostgres = config.storageMode === "postgres";
const repo = usingPostgres ? require("./repositories") : require("./mockRepository");
const pool = usingPostgres ? require("./db/pool").pool : null;

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error("Validation failed");
    error.status = 400;
    error.details = result.error.flatten();
    throw error;
  }
  return result.data;
}

function createApp(realtime) {
  const app = express();

  app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      if (repo.healthCheck) {
        await repo.healthCheck();
      } else if (pool) {
        await pool.query("SELECT 1");
      }

      res.json({
        ok: true,
        service: "gloving-backend",
        storage: config.storageMode,
        timestamp: new Date().toISOString()
      });
    })
  );

  // Hardware-facing routes — no auth required (ESP32 glove has no user session)
  app.post(
    "/api/glove/event",
    asyncHandler(async (req, res) => {
      const input = validate(gestureEventSchema, req.body);
      const event = await repo.createGestureEvent(input);
      realtime.broadcastGesture(event);
      res.status(201).json(event);
    })
  );

  app.post(
    "/api/dev/fake-gesture",
    asyncHandler(async (req, res) => {
      const patientId = req.body?.patientId || req.query.patientId || "demo-patient-1";
      const fakeEvent = {
        ...fakeGestureEvent(patientId),
        sessionId: req.body?.sessionId || req.query.sessionId || undefined
      };
      const event = await repo.createGestureEvent(fakeEvent);
      realtime.broadcastGesture(event);
      res.status(201).json(event);
    })
  );

  // Calibration + latest event — no auth (bridge + hardware-facing)
  app.get(
    "/api/glove/latest",
    asyncHandler(async (_req, res) => {
      const event = await repo.getLatestGloveEvent();
      if (!event) return res.status(404).json({ error: "No glove data yet" });
      res.json(event);
    })
  );

  app.post(
    "/api/calibration",
    asyncHandler(async (req, res) => {
      const { patientId, open, closed } = req.body || {};
      if (!patientId || !open || !closed) return res.status(400).json({ error: "Missing fields: patientId, open, closed" });
      res.json(await repo.saveCalibration(patientId, { patientId, open, closed }));
    })
  );

  app.get(
    "/api/calibration/:patientId",
    asyncHandler(async (req, res) => {
      const cal = await repo.getCalibration(req.params.patientId);
      if (!cal) return res.status(404).json({ error: "No calibration found" });
      res.json(cal);
    })
  );

  // All remaining /api/* routes require a valid Supabase JWT
  app.use("/api", requireAuth);

  app.post(
    "/api/auth/me",
    asyncHandler(async (req, res) => {
      const therapist = await repo.createOrGetTherapist(
        req.user.id,
        req.user.email,
        req.body?.name
      );
      res.json(therapist);
    })
  );

  app.get(
    "/api/patients",
    asyncHandler(async (_req, res) => {
      res.json(await repo.listPatients());
    })
  );

  app.post(
    "/api/patients",
    asyncHandler(async (req, res) => {
      const input = validate(createPatientSchema, req.body);
      res.status(201).json(await repo.createPatient(input));
    })
  );

  app.get(
    "/api/patients/:id",
    asyncHandler(async (req, res) => {
      const patient = await repo.getPatient(req.params.id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      res.json(patient);
    })
  );

  app.get(
    "/api/patients/:id/sessions",
    asyncHandler(async (req, res) => {
      res.json(await repo.listPatientSessions(req.params.id));
    })
  );

  app.get(
    "/api/patients/:id/assignments",
    asyncHandler(async (req, res) => {
      res.json(repo.listPatientAssignments ? await repo.listPatientAssignments(req.params.id) : []);
    })
  );

  app.get(
    "/api/patients/:id/exercise-assignments",
    asyncHandler(async (req, res) => {
      res.json(repo.listPatientExerciseAssignments ? await repo.listPatientExerciseAssignments(req.params.id) : []);
    })
  );

  app.get(
    "/api/patients/:id/appointments",
    asyncHandler(async (req, res) => {
      res.json(repo.listPatientAppointments ? await repo.listPatientAppointments(req.params.id) : []);
    })
  );

  app.get(
    "/api/patients/:id/alerts",
    asyncHandler(async (req, res) => {
      res.json(repo.listPatientAlerts ? await repo.listPatientAlerts(req.params.id) : []);
    })
  );

  app.get(
    "/api/patients/:id/analytics",
    asyncHandler(async (req, res) => {
      if (!repo.getAnalytics) return res.json({});
      res.json(await repo.getAnalytics(req.params.id));
    })
  );

  app.get(
    "/api/patients/:id/difficulty-recommendation",
    asyncHandler(async (req, res) => {
      if (!repo.getDifficultyRecommendation) return res.json({});
      res.json(await repo.getDifficultyRecommendation(req.params.id));
    })
  );

  app.patch(
    "/api/patients/:id/notes",
    asyncHandler(async (req, res) => {
      const input = validate(updatePatientNotesSchema, req.body || {});
      if (!repo.updatePatientNotes) return res.status(404).json({ error: "Notes are not supported" });
      const patient = await repo.updatePatientNotes(req.params.id, input.notes);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      res.json(patient);
    })
  );

  app.get(
    "/api/patients/:id/progress",
    asyncHandler(async (req, res) => {
      res.json(await repo.getPatientProgress(req.params.id));
    })
  );

  app.post(
    "/api/sessions/start",
    asyncHandler(async (req, res) => {
      const input = validate(startSessionSchema, req.body);
      res.status(201).json(await repo.startSession(input));
    })
  );

  app.post(
    "/api/sessions/:id/end",
    asyncHandler(async (req, res) => {
      const input = validate(endSessionSchema, req.body || {});
      const result = await repo.endSession(req.params.id, input);
      if (!result) return res.status(404).json({ error: "Session not found" });
      res.json(result);
    })
  );

  app.get(
    "/api/sessions/:id",
    asyncHandler(async (req, res) => {
      if (!repo.getSession) return res.status(404).json({ error: "Session not found" });
      const session = await repo.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    })
  );

  app.get(
    "/api/sessions/:id/events",
    asyncHandler(async (req, res) => {
      res.json(await repo.listSessionEvents(req.params.id));
    })
  );

  app.get(
    "/api/exercises",
    asyncHandler(async (_req, res) => {
      res.json(await repo.listExercises());
    })
  );

  app.post(
    "/api/exercises",
    asyncHandler(async (req, res) => {
      const input = validate(createExerciseSchema, req.body);
      res.status(201).json(await repo.createExercise(input));
    })
  );

  app.post(
    "/api/exercise-results",
    asyncHandler(async (req, res) => {
      const input = validate(exerciseResultSchema, req.body);
      res.status(201).json(await repo.createExerciseResult(input));
    })
  );

  app.post(
    "/api/assignments",
    asyncHandler(async (req, res) => {
      const input = validate(assignmentSchema, req.body);
      if (!repo.createAssignment) return res.status(501).json({ error: "Assignments are not supported" });
      res.status(201).json(await repo.createAssignment(input));
    })
  );

  app.patch(
    "/api/assignments/:id",
    asyncHandler(async (req, res) => {
      if (!repo.updateAssignment) return res.status(501).json({ error: "Assignments are not supported" });
      const assignment = await repo.updateAssignment(req.params.id, req.body || {});
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });
      res.json(assignment);
    })
  );

  app.delete(
    "/api/assignments/:id",
    asyncHandler(async (req, res) => {
      if (!repo.deleteAssignment) return res.status(501).json({ error: "Assignment delete is not supported" });
      const removed = await repo.deleteAssignment(req.params.id);
      if (!removed) return res.status(404).json({ error: "Assignment not found" });
      res.status(204).send();
    })
  );

  app.post(
    "/api/exercise-assignments",
    asyncHandler(async (req, res) => {
      const input = validate(exerciseAssignmentSchema, req.body);
      if (!repo.createExerciseAssignment) return res.status(501).json({ error: "Exercise assignments are not supported" });
      res.status(201).json(await repo.createExerciseAssignment(input));
    })
  );

  app.delete(
    "/api/exercise-assignments/:id",
    asyncHandler(async (req, res) => {
      if (!repo.deleteExerciseAssignment) {
        return res.status(501).json({ error: "Exercise assignment delete is not supported" });
      }
      const removed = await repo.deleteExerciseAssignment(req.params.id);
      if (!removed) return res.status(404).json({ error: "Exercise assignment not found" });
      res.status(204).send();
    })
  );

  app.get(
    "/api/appointments",
    asyncHandler(async (_req, res) => {
      res.json(repo.listAppointments ? await repo.listAppointments() : []);
    })
  );

  app.post(
    "/api/appointments",
    asyncHandler(async (req, res) => {
      const input = validate(appointmentSchema, req.body);
      if (!repo.createAppointment) return res.status(501).json({ error: "Appointments are not supported" });
      res.status(201).json(await repo.createAppointment(input));
    })
  );

  app.patch(
    "/api/appointments/:id",
    asyncHandler(async (req, res) => {
      if (!repo.updateAppointment) return res.status(501).json({ error: "Appointments are not supported" });
      const appointment = await repo.updateAppointment(req.params.id, req.body || {});
      if (!appointment) return res.status(404).json({ error: "Appointment not found" });
      res.json(appointment);
    })
  );

  app.get(
    "/api/alerts",
    asyncHandler(async (_req, res) => {
      res.json(repo.listAlerts ? await repo.listAlerts() : []);
    })
  );

  app.post(
    "/api/ai/progress-summary",
    asyncHandler(async (req, res) => {
      const input = validate(progressSummarySchema, req.body || {});
      if (!repo.createProgressSummary) return res.status(501).json({ error: "AI summary is not supported" });
      const summary = await repo.createProgressSummary(input.patientId);
      if (!summary) return res.status(404).json({ error: "Patient not found" });
      res.json(summary);
    })
  );

  app.post(
    "/api/ai/patient-chat",
    asyncHandler(async (req, res) => {
      res.json({
        message:
          "Demo assistant stub: patient coaching chat is not enabled for this hackathon build. Clinician review recommended.",
        received: req.body || {}
      });
    })
  );

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found", path: req.path });
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({
      error: status === 500 ? "Internal server error" : error.message,
      details: error.details
    });

    if (status === 500) {
      console.error(error);
    }
  });

  return app;
}

async function main() {
  const server = http.createServer();
  const realtime = createRealtimeServer(server);
  const app = createApp(realtime);

  server.on("request", app);
  server.listen(config.port, () => {
    console.log(`Gloving backend listening on http://localhost:${config.port}`);
    console.log(`WebSocket live updates available at ws://localhost:${config.port}/ws`);
    console.log(`Storage mode: ${config.storageMode}`);
  });

  async function shutdown() {
    server.close(async () => {
      if (pool) {
        await pool.end();
      }
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp };
