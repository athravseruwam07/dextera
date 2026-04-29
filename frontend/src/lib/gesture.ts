import type {
  FingerBends,
  FingerName,
  GestureEvent,
  GestureName,
  Patient,
  PatientSummary,
  RehabSession
} from "../types";

export const fingerNames: FingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky"
];

export const gestureLabels: Record<GestureName, string> = {
  open: "Open hand",
  fist: "Fist",
  pinch: "Pinch",
  point: "Point",
  tap_thumb: "Thumb tap",
  tap_index: "Index tap",
  tap_middle: "Middle tap",
  tap_ring: "Ring tap",
  tap_pinky: "Pinky tap",
  flick: "Flick"
};

export const gestureTargets: Record<GestureName, FingerBends> = {
  open: { thumb: 12, index: 8, middle: 9, ring: 11, pinky: 10 },
  fist: { thumb: 82, index: 91, middle: 88, ring: 76, pinky: 72 },
  pinch: { thumb: 76, index: 74, middle: 18, ring: 15, pinky: 13 },
  point: { thumb: 52, index: 12, middle: 83, ring: 78, pinky: 75 },
  tap_thumb: { thumb: 86, index: 18, middle: 18, ring: 16, pinky: 15 },
  tap_index: { thumb: 18, index: 86, middle: 18, ring: 16, pinky: 15 },
  tap_middle: { thumb: 18, index: 18, middle: 86, ring: 16, pinky: 15 },
  tap_ring: { thumb: 18, index: 18, middle: 18, ring: 86, pinky: 15 },
  tap_pinky: { thumb: 18, index: 18, middle: 18, ring: 16, pinky: 86 },
  flick: { thumb: 36, index: 88, middle: 34, ring: 24, pinky: 22 }
};

const gestureOrder: GestureName[] = [
  "open",
  "fist",
  "pinch",
  "point",
  "tap_thumb",
  "tap_index",
  "tap_middle",
  "tap_ring",
  "tap_pinky",
  "flick"
];

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyGesture(bends: FingerBends): GestureName {
  const allStraight = fingerNames.every((finger) => bends[finger] < 28);
  if (allStraight) return "open";

  const allBent = fingerNames.every((finger) => bends[finger] > 62);
  if (allBent) return "fist";

  const point =
    bends.index < 28 &&
    bends.middle > 58 &&
    bends.ring > 58 &&
    bends.pinky > 54;
  if (point) return "point";

  const pinch =
    bends.thumb > 58 &&
    bends.index > 56 &&
    bends.middle < 42 &&
    bends.ring < 48 &&
    bends.pinky < 52;
  if (pinch) return "pinch";

  return nearestGesture(bends);
}

export function nearestGesture(bends: FingerBends): GestureName {
  return gestureOrder
    .map((gesture) => ({
      gesture,
      distance: fingerNames.reduce((sum, finger) => {
        return sum + Math.abs(bends[finger] - gestureTargets[gesture][finger]);
      }, 0)
    }))
    .sort((a, b) => a.distance - b.distance)[0].gesture;
}

export function scoreAccuracy(event: FingerBends, gesture: GestureName): number {
  const target = gestureTargets[gesture];
  const distance = fingerNames.reduce((sum, finger) => {
    return sum + Math.abs(event[finger] - target[finger]);
  }, 0);
  return clampPercent(100 - distance / fingerNames.length);
}

export function averageFinger(events: GestureEvent[], finger: FingerName): number {
  if (!events.length) return 0;
  return clampPercent(
    events.reduce((sum, event) => sum + event[finger], 0) / events.length
  );
}

export function averageAccuracy(events: GestureEvent[]): number {
  if (!events.length) return 0;
  return clampPercent(
    events.reduce((sum, event) => sum + event.accuracy, 0) / events.length
  );
}

export function weakestFinger(events: GestureEvent[]): FingerName {
  if (!events.length) return "ring";

  return fingerNames
    .map((finger) => ({
      finger,
      mobility: rangeOfMotion(events, finger)
    }))
    .sort((a, b) => a.mobility - b.mobility)[0].finger;
}

export function rangeOfMotion(events: GestureEvent[], finger: FingerName): number {
  if (!events.length) return 0;
  const values = events.map((event) => event[finger]);
  return clampPercent(Math.max(...values) - Math.min(...values));
}

export function mobilityScore(events: GestureEvent[]): number {
  if (!events.length) return 0;
  return clampPercent(
    fingerNames.reduce((sum, finger) => sum + rangeOfMotion(events, finger), 0) /
      fingerNames.length
  );
}

export function flattenEvents(sessions: RehabSession[]): GestureEvent[] {
  return sessions.flatMap((session) => session.events);
}

export function summarizePatient(patient: Patient): PatientSummary {
  const events = flattenEvents(patient.sessions);
  const repsCompleted = patient.sessions.reduce(
    (sum, session) => sum + session.repsCompleted,
    0
  );
  const bestFistScore = patient.sessions.reduce(
    (best, session) => Math.max(best, session.bestFistScore),
    0
  );
  const fatigueWarnings = patient.sessions.reduce(
    (sum, session) => sum + session.fatigueWarnings,
    0
  );
  const mobility = mobilityScore(events);

  return {
    totalSessions: patient.sessions.length,
    repsCompleted,
    bestFistScore,
    averageAccuracy: averageAccuracy(events),
    mobilityScore: mobility,
    weakestFinger: weakestFinger(events),
    fatigueWarnings,
    improvement: clampPercent(mobility - patient.baselineMobility)
  };
}

export function sessionFromDraft(
  draft: {
    id: string;
    patientId: string;
    assignmentId?: string | null;
    exercise: { id: string; name: string; targetReps: number };
    startedAt: string;
    events: GestureEvent[];
    repsCompleted: number;
    notes: string;
  },
  endedAt = new Date().toISOString()
): RehabSession {
  const events = draft.events;
  const fistEvents = events.filter((event) => event.gesture === "fist");
  const fatigueWarnings = events.filter(
    (event) => event.smoothness < 50 || event.holdMs > 5000
  ).length;

  return {
    id: draft.id,
    patientId: draft.patientId,
    assignmentId: draft.assignmentId,
    gameId: draft.exercise.id,
    gameName: draft.exercise.name,
    exerciseId: draft.exercise.id,
    exerciseName: draft.exercise.name,
    startedAt: draft.startedAt,
    endedAt,
    repsCompleted: draft.repsCompleted,
    targetReps: draft.exercise.targetReps,
    averageAccuracy: averageAccuracy(events),
    bestFistScore: fistEvents.length
      ? Math.max(...fistEvents.map((event) => event.accuracy))
      : 0,
    fatigueWarnings,
    notes: draft.notes,
    events
  };
}
