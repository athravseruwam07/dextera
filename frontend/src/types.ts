export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export type GestureName =
  | "open"
  | "fist"
  | "pinch"
  | "point"
  | "tap_thumb"
  | "tap_index"
  | "tap_middle"
  | "tap_ring"
  | "tap_pinky"
  | "flick";

export type ViewName =
  | "dashboard"
  | "patients"
  | "appointments"
  | "patient"
  | "rehab-games"
  | "rehab-calendar"
  | "rehab-assistant"
  | "exercises"
  | "glove-dev";

export type PatientTab = "overview" | "plan" | "sessions" | "live" | "appointments" | "notes";

export type GameId = "ball-pickup" | "finger-tap-piano" | "bubble-pop" | "carrom-flick";

export type InputMode = "glove";

export type Difficulty = "easy" | "medium" | "hard";

export interface HandPosition {
  x: number;
  y: number;
  z: number;
}

export interface FingerBends {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
}

export interface FingerTapCalibrationProfile {
  finger: FingerName;
  raw: FingerBends;
  bends: FingerBends;
  signal: number;
  stability: number;
  pressThreshold: number;
  releaseThreshold: number;
  confidenceThreshold: number;
}

export interface GestureEvent extends FingerBends {
  id: string;
  patientId: string;
  sessionId?: string;
  gesture: GestureName;
  timestamp: string;
  accuracy: number;
  holdMs: number;
  smoothness: number;
  handX?: number;
  handY?: number;
  handZ?: number;
  rawValues?: Record<string, number>;
}

export interface RehabSession {
  id: string;
  patientId: string;
  assignmentId?: string | null;
  gameId?: string;
  gameName?: string;
  exerciseId: string;
  exerciseName: string;
  startedAt: string;
  endedAt: string;
  repsRequired?: number;
  repsCompleted: number;
  targetReps: number;
  successfulReps?: number;
  failedAttempts?: number;
  accuracy?: number;
  timeTaken?: number;
  score?: number;
  inputMode?: "camera" | "glove" | "demo";
  painBefore?: number;
  painAfter?: number;
  fatigueBefore?: number;
  fatigueAfter?: number;
  weakestFinger?: FingerName;
  bestStreak?: number;
  averageAccuracy: number;
  bestFistScore: number;
  fatigueWarnings: number;
  notes: string;
  events: GestureEvent[];
}

export interface Patient {
  id: string;
  userId?: string;
  doctorId?: string;
  name: string;
  age: number;
  diagnosis: string;
  condition?: string;
  therapist: string;
  status: "active" | "paused" | "review" | "improving" | "stable" | "low_adherence" | "needs_review";
  goal: string;
  recoveryGoal?: string;
  affectedHand?: "left" | "right" | "both";
  notes?: string;
  createdAt?: string;
  baselineMobility: number;
  sessions: RehabSession[];
}

export interface ExerciseTemplate {
  id: string;
  name: string;
  goal: string;
  targetGesture: GestureName;
  durationMinutes: number;
  targetReps: number;
  difficulty: "easy" | "medium" | "hard";
  instructions: string;
}

export interface SessionDraft {
  id: string;
  patientId: string;
  assignmentId?: string | null;
  exercise: ExerciseTemplate;
  startedAt: string;
  events: GestureEvent[];
  repsCompleted: number;
  notes: string;
}

export interface PatientSummary {
  totalSessions: number;
  repsCompleted: number;
  bestFistScore: number;
  averageAccuracy: number;
  mobilityScore: number;
  weakestFinger: FingerName;
  fatigueWarnings: number;
  improvement: number;
}

export interface User {
  id: string;
  name: string;
  role: "doctor" | "patient";
  email: string;
}

export interface Doctor {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialty: string;
}

export interface Game {
  id: string;
  name: string;
  description: string;
  targetSkills: string[];
  supportedInputModes: Array<"camera" | "glove" | "demo">;
  defaultDifficulty: "easy" | "medium" | "hard";
  route?: string;
}

export interface Assignment {
  id: string;
  patientId: string;
  doctorId: string;
  gameId: string;
  gameName: string;
  difficulty: "easy" | "medium" | "hard";
  reps?: number | null;
  rounds?: number | null;
  frequency: string;
  dueDate: string;
  targetSkill: string;
  notes?: string;
  status: "assigned" | "completed" | "missed";
  createdAt: string;
  updatedAt?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  date: string;
  time: string;
  type: string;
  notes?: string;
  status: "scheduled" | "completed" | "cancelled";
  createdAt?: string;
}

export interface Alert {
  id: string;
  patientId: string;
  type: "missed_session" | "pain_increase" | "fatigue_increase" | "weak_finger" | "low_adherence";
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  createdAt: string;
  resolved: boolean;
}

export interface ProgressSummary {
  patientId: string;
  weeklyCompletionRate: number;
  averageAccuracy: number;
  latestAccuracy: number;
  weakestFinger: FingerName;
  painTrend: string;
  fatigueTrend: string;
  improvementPercent: number;
  recommendation: string;
}

export interface AiProgressSummary {
  patientId: string;
  summary: string;
  generatedAt: string;
}

export interface DifficultyRecommendation {
  patientId: string;
  recommendation: string;
  reason: string;
  label: string;
}

/** Patient-facing rehab plan items (distinct from clinician dashboard `Assignment`). */
export interface GameConfig {
  targetReps: number;
  rounds: number;
  frequency: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  targetSkills: string[];
}

export interface PatientCareAssignment {
  id: string;
  patientId: string;
  gameId: GameId;
  name: string;
  config: GameConfig;
  doctorInstructions: string;
  doctorNotes: string;
  dueDate: string;
  status: "assigned" | "in-progress" | "completed" | "missed";
}

export interface PatientCareAppointment {
  id: string;
  patientId: string;
  startsAt: string;
  clinician: string;
  title: string;
  location: string;
  status: "upcoming" | "completed" | "missed";
}

export interface CheckIn {
  phase: "pre" | "post";
  pain: number;
  fatigue: number;
  recordedAt: string;
}

export type CalibrationStep = "open" | "fist" | "point" | "pinch" | "tap";

export interface CalibrationData {
  id: string;
  patientId: string;
  assignmentId: string;
  inputMode: InputMode;
  completedAt: string;
  steps: Partial<Record<CalibrationStep, FingerBends>>;
  fingerTaps: Partial<Record<FingerName, FingerBends>>;
  fingerTapProfiles?: Partial<Record<FingerName, FingerTapCalibrationProfile>>;
  thresholds: {
    openAverage: number;
    fistAverage: number;
    pinchIndexGap: number;
  };
}

export interface SessionResult {
  id: string;
  patientId: string;
  assignmentId: string;
  gameId: GameId;
  gameName: string;
  startedAt: string;
  endedAt: string;
  repsCompleted: number;
  successfulReps: number;
  failedAttempts: number;
  accuracy: number;
  timeTakenSeconds: number;
  gameMetrics?: Record<string, unknown>;
  inputMode: InputMode;
  weakestFinger?: FingerName;
  painBefore: CheckIn;
  painAfter: CheckIn;
  calibration?: CalibrationData;
  events: GestureEvent[];
  encouragement: string;
  savedAt?: string;
}
