import type {
  ExerciseTemplate,
  FingerBends,
  FingerName,
  GestureEvent,
  GestureName,
  Patient,
  RehabSession
} from "../types";
import { clampPercent, gestureTargets, scoreAccuracy } from "../lib/gesture";
import { fingerExercises } from "./exercises";

const gestures: GestureName[] = ["open", "fist", "pinch", "point", "tap_index", "flick"];

function liveMonitorGestureForExercise(fingers: FingerName[]): GestureName {
  if (fingers.length === 1) {
    return `tap_${fingers[0]}` as GestureName;
  }

  if (fingers.includes("thumb")) {
    return "pinch";
  }

  return "fist";
}

function exerciseDurationMinutes(difficulty: ExerciseTemplate["difficulty"]): number {
  if (difficulty === "hard") {
    return 8;
  }

  if (difficulty === "medium") {
    return 6;
  }

  return 5;
}

function formatFingerTargets(fingers: FingerName[]): string {
  return fingers.map((finger) => finger[0].toUpperCase() + finger.slice(1)).join(" + ");
}

export const basicExerciseTemplates: ExerciseTemplate[] = fingerExercises.map((exercise) => ({
  id: exercise.id,
  name: exercise.name,
  goal: exercise.description,
  targetGesture: liveMonitorGestureForExercise(exercise.fingers),
  durationMinutes: exerciseDurationMinutes(exercise.difficulty),
  targetReps: exercise.reps,
  difficulty: exercise.difficulty,
  instructions: `Complete ${exercise.reps} controlled reps. Target: ${formatFingerTargets(
    exercise.fingers
  )}. ${exercise.description}`
}));

export const exerciseTemplates: ExerciseTemplate[] = [
  {
    id: "ball-pickup",
    name: "Ball Pickup",
    goal: "Practice controlled fist closure and open-hand release",
    targetGesture: "fist",
    durationMinutes: 8,
    targetReps: 18,
    difficulty: "easy",
    instructions:
      "Alternate fist and open-hand gestures while the therapist tracks bend range, accuracy, and fatigue."
  },
  {
    id: "finger-tap-piano",
    name: "Finger Tap Piano",
    goal: "Improve finger isolation and timing",
    targetGesture: "tap_index",
    durationMinutes: 6,
    targetReps: 3,
    difficulty: "easy",
    instructions:
      "Tap individual fingers to piano cues while the therapist reviews timing."
  },
  {
    id: "bubble-pop",
    name: "Bubble Pop",
    goal: "Improve pointing, reach, and reaction time",
    targetGesture: "point",
    durationMinutes: 5,
    targetReps: 20,
    difficulty: "medium",
    instructions:
      "Use point gestures to pop targets while keeping other fingers controlled."
  },
  {
    id: "carrom-flick",
    name: "Carrom",
    goal: "Improve finger extension and flick precision",
    targetGesture: "flick",
    durationMinutes: 6,
    targetReps: 5,
    difficulty: "medium",
    instructions:
      "Use a controlled flick gesture to aim the striker and pocket carrom coins."
  },
  ...basicExerciseTemplates
];

function noise(seed: number, spread = 8): number {
  const raw = Math.sin(seed * 12.9898) * 43758.5453;
  return (raw - Math.floor(raw) - 0.5) * spread * 2;
}

function bendSet(gesture: GestureName, seed: number): FingerBends {
  const target = gestureTargets[gesture];
  return {
    thumb: clampPercent(target.thumb + noise(seed + 1)),
    index: clampPercent(target.index + noise(seed + 2)),
    middle: clampPercent(target.middle + noise(seed + 3)),
    ring: clampPercent(target.ring + noise(seed + 4)),
    pinky: clampPercent(target.pinky + noise(seed + 5))
  };
}

export function createGestureEvent(
  patientId: string,
  gesture: GestureName = gestures[Math.floor(Math.random() * gestures.length)],
  sessionId?: string,
  timestamp = new Date().toISOString()
): GestureEvent {
  const seed = Date.now() / 1000 + Math.random() * 100;
  const bends = bendSet(gesture, seed);
  return {
    id: `gesture-${Math.round(seed * 1000)}-${Math.floor(Math.random() * 1000)}`,
    patientId,
    sessionId,
    gesture,
    timestamp,
    accuracy: scoreAccuracy(bends, gesture),
    holdMs: Math.round(500 + Math.random() * 2200),
    smoothness: clampPercent(58 + Math.random() * 38),
    handX: Number(Math.random().toFixed(3)),
    handY: Number(Math.random().toFixed(3)),
    handZ: Number(Math.random().toFixed(3)),
    ...bends
  };
}

function historicalEvent(
  patientId: string,
  sessionId: string,
  gesture: GestureName,
  index: number,
  sessionDate: Date
): GestureEvent {
  const timestamp = new Date(sessionDate.getTime() + index * 18_000).toISOString();
  const bends = bendSet(gesture, index * 7 + sessionDate.getDate());
  return {
    id: `${sessionId}-g-${index}`,
    patientId,
    sessionId,
    gesture,
    timestamp,
    accuracy: clampPercent(scoreAccuracy(bends, gesture) - 4 + (index % 5)),
    holdMs: 700 + (index % 6) * 260,
    smoothness: clampPercent(62 + (index % 8) * 4),
    handX: Number((0.2 + (index % 6) * 0.08).toFixed(3)),
    handY: Number((0.25 + (index % 5) * 0.09).toFixed(3)),
    handZ: Number((0.3 + (index % 3) * 0.1).toFixed(3)),
    ...bends
  };
}

function makeSession(
  patientId: string,
  dayOffset: number,
  repsCompleted: number,
  targetReps: number,
  accuracyBoost = 0
): RehabSession {
  const startedAt = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
  startedAt.setHours(14, 30, 0, 0);
  const exercise = exerciseTemplates[0];
  const sessionId = `session-${patientId}-${dayOffset}`;
  const eventPlan: GestureName[] = [];

  for (let rep = 0; rep < repsCompleted; rep += 1) {
    eventPlan.push("point", "fist", "open");
  }

  const events = eventPlan.map((gesture, index) => {
    const event = historicalEvent(patientId, sessionId, gesture, index, startedAt);
    return { ...event, accuracy: clampPercent(event.accuracy + accuracyBoost) };
  });
  const fistScores = events
    .filter((event) => event.gesture === "fist")
    .map((event) => event.accuracy);

  return {
    id: sessionId,
    patientId,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + 9 * 60 * 1000).toISOString(),
    repsCompleted,
    repsRequired: targetReps,
    targetReps,
    successfulReps: repsCompleted,
    failedAttempts: Math.max(0, targetReps - repsCompleted),
    accuracy: clampPercent(
      events.reduce((sum, event) => sum + event.accuracy, 0) / events.length
    ),
    timeTaken: 540,
    score: repsCompleted * 80,
    inputMode: "demo",
    painBefore: 2,
    painAfter: 3,
    fatigueBefore: 2,
    fatigueAfter: 3,
    weakestFinger: "ring",
    averageAccuracy: clampPercent(
      events.reduce((sum, event) => sum + event.accuracy, 0) / events.length
    ),
    bestFistScore: Math.max(...fistScores),
    fatigueWarnings: Math.max(0, Math.floor((targetReps - repsCompleted) / 3)),
    notes:
      repsCompleted >= targetReps
        ? "Completed target reps with stable release timing."
        : "Stopped early after mild fatigue in ring and pinky fingers.",
    events
  };
}

export const seedPatients: Patient[] = [
  {
    id: "patient-1",
    userId: "user-patient-1",
    doctorId: "doctor-1",
    name: "Maya Patel",
    age: 52,
    diagnosis: "Stroke hand rehabilitation",
    condition: "Stroke hand rehabilitation",
    therapist: "Dr. Singh",
    status: "improving",
    goal: "Improve right-hand grip and release control",
    recoveryGoal: "Improve right-hand grip and release control",
    affectedHand: "right",
    notes: "Focus on fully opening hand before releasing objects.",
    baselineMobility: 42,
    sessions: [
      makeSession("patient-1", 12, 7, 10, -10),
      makeSession("patient-1", 8, 8, 10, -2),
      makeSession("patient-1", 5, 9, 10, 3),
      makeSession("patient-1", 3, 3, 3, 5),
      makeSession("patient-1", 1, 10, 10, 7)
    ]
  },
  {
    id: "patient-2",
    userId: "user-patient-2",
    doctorId: "doctor-1",
    name: "Daniel Lee",
    age: 34,
    diagnosis: "Post-injury hand therapy",
    condition: "Post-injury hand therapy",
    therapist: "Dr. Singh",
    status: "low_adherence",
    goal: "Improve finger extension and controlled grip",
    recoveryGoal: "Improve finger extension and controlled grip",
    affectedHand: "left",
    notes: "Prefers shorter sessions. Review pain report before raising difficulty.",
    baselineMobility: 48,
    sessions: [
      makeSession("patient-2", 9, 1, 2, -18),
      makeSession("patient-2", 6, 1, 2, -15)
    ]
  },
  {
    id: "patient-3",
    userId: "user-patient-3",
    doctorId: "doctor-1",
    name: "Amira Khan",
    age: 46,
    diagnosis: "Fine motor recovery",
    condition: "Fine motor recovery",
    therapist: "Dr. Singh",
    status: "stable",
    goal: "Improve finger isolation and coordination",
    recoveryGoal: "Improve finger isolation and coordination",
    affectedHand: "right",
    notes: "Piano-style finger taps are useful for engagement.",
    baselineMobility: 36,
    sessions: [
      makeSession("patient-3", 10, 4, 5, -3),
      makeSession("patient-3", 4, 5, 5, 1),
      makeSession("patient-3", 2, 5, 5, 5)
    ]
  }
];

export function nextGesture(previous: GestureName): GestureName {
  const index = gestures.indexOf(previous);
  return gestures[(index + 1) % gestures.length];
}
