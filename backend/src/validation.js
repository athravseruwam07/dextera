const { z } = require("zod");

const gestureNames = [
  "open",
  "fist",
  "pinch",
  "point",
  "tap_thumb",
  "tap_index",
  "tap_middle",
  "tap_ring",
  "tap_pinky",
  "flick",
  "unknown"
];
const fingerValue = z.coerce.number().int().min(0).max(100);

const gestureEventSchema = z.object({
  patientId: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  gloveId: z.string().uuid().optional(),
  gesture: z.enum(gestureNames).default("unknown"),
  thumb: fingerValue,
  index: fingerValue,
  middle: fingerValue,
  ring: fingerValue,
  pinky: fingerValue,
  handX: z.coerce.number().min(0).max(1).optional(),
  handY: z.coerce.number().min(0).max(1).optional(),
  handZ: z.coerce.number().min(0).max(1).optional(),
  accuracy: z.coerce.number().min(0).max(100).optional(),
  timestamp: z.coerce.date().optional(),
  raw: z.record(z.any()).optional(),
  rawValues: z.record(z.number()).optional()
});

const createPatientSchema = z.object({
  id: z.string().min(1).optional(),
  therapistId: z.string().uuid().optional(),
  displayName: z.string().min(1),
  dateOfBirth: z.string().date().optional(),
  dominantHand: z.enum(["left", "right", "unknown"]).default("unknown"),
  notes: z.string().optional()
});

const startSessionSchema = z.object({
  patientId: z.string().min(1),
  assignmentId: z.string().min(1).optional(),
  gameId: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  inputMode: z.enum(["camera", "glove", "demo"]).default("demo"),
  painBefore: z.coerce.number().int().min(0).max(10).default(0),
  fatigueBefore: z.coerce.number().int().min(0).max(10).default(0),
  therapistId: z.string().min(1).optional(),
  gloveId: z.string().min(1).optional(),
  exerciseId: z.string().min(1).optional(),
  notes: z.string().optional()
});

const endSessionSchema = z.object({
  notes: z.string().optional(),
  repsRequired: z.coerce.number().int().min(0).optional(),
  repsCompleted: z.coerce.number().int().min(0).optional(),
  successfulReps: z.coerce.number().int().min(0).optional(),
  failedAttempts: z.coerce.number().int().min(0).optional(),
  accuracy: z.coerce.number().min(0).max(100).optional(),
  timeTaken: z.coerce.number().int().min(0).optional(),
  score: z.coerce.number().int().min(0).optional(),
  painAfter: z.coerce.number().int().min(0).max(10).optional(),
  fatigueAfter: z.coerce.number().int().min(0).max(10).optional(),
  weakestFinger: z.enum(["thumb", "index", "middle", "ring", "pinky"]).optional(),
  exerciseResult: z
    .object({
      exerciseId: z.string().uuid().optional(),
      repsCompleted: z.coerce.number().int().min(0).default(0),
      successfulReps: z.coerce.number().int().min(0).default(0),
      bestAccuracy: z.coerce.number().min(0).max(100).optional(),
      averageAccuracy: z.coerce.number().min(0).max(100).optional(),
      holdTimeMs: z.coerce.number().int().min(0).optional(),
      smoothness: z.coerce.number().min(0).max(100).optional(),
      metadata: z.record(z.any()).default({})
    })
    .optional()
});

const createExerciseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  targetGesture: z.enum(gestureNames).optional(),
  difficulty: z.coerce.number().int().min(1).max(10).default(1),
  config: z.record(z.any()).default({})
});

const exerciseResultSchema = z.object({
  sessionId: z.string().uuid(),
  exerciseId: z.string().uuid().optional(),
  patientId: z.string().min(1),
  repsCompleted: z.coerce.number().int().min(0).default(0),
  successfulReps: z.coerce.number().int().min(0).default(0),
  bestAccuracy: z.coerce.number().min(0).max(100).optional(),
  averageAccuracy: z.coerce.number().min(0).max(100).optional(),
  holdTimeMs: z.coerce.number().int().min(0).optional(),
  smoothness: z.coerce.number().min(0).max(100).optional(),
  metadata: z.record(z.any()).default({})
});

const assignmentSchema = z.object({
  patientId: z.string().min(1),
  doctorId: z.string().min(1).default("doctor-1"),
  gameId: z.string().min(1),
  gameName: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("easy"),
  reps: z.coerce.number().int().min(0).optional(),
  rounds: z.coerce.number().int().min(0).optional(),
  frequency: z.string().min(1),
  dueDate: z.string().min(1),
  targetSkill: z.string().min(1),
  notes: z.string().optional(),
  status: z.enum(["assigned", "completed", "missed"]).default("assigned")
});

const exerciseAssignmentSchema = z.object({
  id: z.string().min(1).optional(),
  patientId: z.string().min(1),
  exerciseId: z.string().min(1),
  assignedAt: z.coerce.date().optional(),
  status: z.enum(["assigned", "completed"]).default("assigned"),
  completedAt: z.coerce.date().nullable().optional(),
  result: z.record(z.any()).nullable().optional()
});

const updateExerciseAssignmentSchema = z.object({
  status: z.enum(["assigned", "completed"]).optional(),
  completedAt: z.coerce.date().nullable().optional(),
  result: z.record(z.any()).nullable().optional()
});

const appointmentSchema = z.object({
  patientId: z.string().min(1),
  doctorId: z.string().min(1).default("doctor-1"),
  date: z.string().min(1),
  time: z.string().min(1),
  type: z.string().min(1),
  notes: z.string().optional(),
  status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled")
});

const progressSummarySchema = z.object({
  patientId: z.string().min(1)
});

const updatePatientNotesSchema = z.object({
  notes: z.string().default("")
});

module.exports = {
  gestureEventSchema,
  createPatientSchema,
  startSessionSchema,
  endSessionSchema,
  createExerciseSchema,
  exerciseResultSchema,
  assignmentSchema,
  exerciseAssignmentSchema,
  updateExerciseAssignmentSchema,
  appointmentSchema,
  progressSummarySchema,
  updatePatientNotesSchema
};
