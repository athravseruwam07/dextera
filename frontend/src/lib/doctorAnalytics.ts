import type { Alert, Assignment, FingerName, GestureEvent, Patient, RehabSession } from "../types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashPatientId(patientId: string) {
  return patientId.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 7), 0);
}

function demoSessionDate(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(16, 15, 0, 0);
  return date;
}

export function demoGraphSessions(patientId: string): RehabSession[] {
  const seed = hashPatientId(patientId);
  const gameCycle = [
    { id: "ball-pickup", name: "Ball Pickup", target: 10 },
    { id: "finger-tap-piano", name: "Finger Tap Piano", target: 12 },
    { id: "bubble-pop", name: "Bubble Pop", target: 8 },
    { id: "carrom-flick", name: "Carrom", target: 6 }
  ];
  const daysAgo = [35, 29, 23, 18, 13, 8, 4, 1];
  const startAccuracy = 58 + (seed % 8);
  const weakFinger: FingerName[] = ["ring", "pinky", "middle", "index"];

  return daysAgo.map((day, index) => {
    const game = gameCycle[(seed + index) % gameCycle.length];
    const date = demoSessionDate(day);
    const accuracy = Math.round(clamp(startAccuracy + index * 3.7 + Math.sin(seed + index) * 3.2, 48, 94));
    const targetReps = game.target + ((seed + index) % 3);
    const repsCompleted = Math.round(clamp(targetReps * (0.62 + index * 0.045 + ((seed + index) % 2) * 0.04), 3, targetReps));
    const fatigueBefore = clamp(2 + ((seed + index) % 3), 0, 10);
    const fatigueAfter = clamp(fatigueBefore + (index < 2 ? 2 : index < 5 ? 1 : 0), 0, 10);
    const painBefore = clamp(1 + ((seed + index * 2) % 3), 0, 10);
    const painAfter = clamp(painBefore + (index < 3 ? 1 : index > 5 ? -1 : 0), 0, 10);

    return {
      id: `demo-graph-${patientId}-${index}`,
      patientId,
      assignmentId: `${patientId}-${game.id}`,
      gameId: game.id,
      gameName: game.name,
      exerciseId: `${patientId}-${game.id}`,
      exerciseName: game.name,
      startedAt: date.toISOString(),
      endedAt: new Date(date.getTime() + (5 + index) * 60_000).toISOString(),
      repsCompleted,
      repsRequired: targetReps,
      targetReps,
      successfulReps: repsCompleted,
      failedAttempts: Math.max(0, targetReps - repsCompleted),
      accuracy,
      timeTaken: (5 + index) * 60,
      score: repsCompleted * 90 + accuracy * 3,
      inputMode: "demo" as const,
      painBefore,
      painAfter,
      fatigueBefore,
      fatigueAfter,
      weakestFinger: weakFinger[(seed + index) % weakFinger.length],
      averageAccuracy: accuracy,
      bestFistScore: Math.min(100, accuracy + 6),
      fatigueWarnings: fatigueAfter - fatigueBefore >= 3 ? 1 : 0,
      notes: "Demo trend sample for graph previews.",
      events: []
    };
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function sessionsForGraph(patientId: string, sessions: RehabSession[]) {
  const patientSessions = sessions.filter((session) => session.patientId === patientId);
  return patientSessions.length >= 2 ? patientSessions : demoGraphSessions(patientId);
}

export function detectWeakestFinger(items: Array<GestureEvent | RehabSession>): {
  weakestFinger: FingerName;
  confidence: number;
  message: string;
} {
  const sessionItems = items.filter((item): item is RehabSession => "weakestFinger" in item && Boolean(item.weakestFinger));
  if (sessionItems.length) {
    const counts = sessionItems.reduce<Record<string, number>>((acc, session) => {
      const finger = session.weakestFinger || "ring";
      acc[finger] = (acc[finger] || 0) + 1;
      return acc;
    }, {});
    const [weakestFinger, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [FingerName, number];
    return {
      weakestFinger,
      confidence: Number((count / sessionItems.length).toFixed(2)),
      message: `${weakestFinger} finger performance was lowest across recent sessions.`
    };
  }

  const eventItems = items.filter((item): item is GestureEvent => "thumb" in item);
  if (!eventItems.length) {
    return { weakestFinger: "ring", confidence: 0, message: "Not enough data yet." };
  }

  const fingers: FingerName[] = ["thumb", "index", "middle", "ring", "pinky"];
  const averages = fingers.map((finger) => ({
    finger,
    value: eventItems.reduce((sum, event) => sum + event[finger], 0) / eventItems.length
  }));
  const weakest = averages.sort((a, b) => a.value - b.value)[0];
  return {
    weakestFinger: weakest.finger,
    confidence: 0.65,
    message: `${weakest.finger} finger performance was lowest across gesture events.`
  };
}

export function getWeeklyCompletionRate(patientId: string, assignments: Assignment[], sessions: RehabSession[]) {
  const patientAssignments = assignments.filter((assignment) => assignment.patientId === patientId);
  if (!patientAssignments.length) return 0;
  if (patientAssignments.some((assignment) => assignment.status === "missed")) return 25;
  const completed = patientAssignments.filter((assignment) =>
    sessions.some((session) => session.assignmentId === assignment.id && session.endedAt)
  ).length;
  return Math.round((completed / patientAssignments.length) * 100);
}

export function getAverageAccuracy(patientId: string, sessions: RehabSession[]) {
  const patientSessions = sessionsForGraph(patientId, sessions);
  if (!patientSessions.length) return 0;
  return Math.round(patientSessions.reduce((sum, session) => sum + (session.accuracy ?? session.averageAccuracy), 0) / patientSessions.length);
}

export function getLatestAccuracy(patientId: string, sessions: RehabSession[]) {
  return [...sessionsForGraph(patientId, sessions)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.accuracy ?? 0;
}

export function getAccuracyTrend(patientId: string, sessions: RehabSession[]) {
  return sessionsForGraph(patientId, sessions)
    .slice()
    .reverse()
    .map((session) => ({ date: session.startedAt.slice(0, 10), accuracy: session.accuracy ?? session.averageAccuracy }));
}

export function getRepsTrend(patientId: string, sessions: RehabSession[]) {
  return sessionsForGraph(patientId, sessions)
    .slice()
    .reverse()
    .map((session) => ({ date: session.startedAt.slice(0, 10), repsCompleted: session.repsCompleted }));
}

export function getPainFatigueTrend(patientId: string, sessions: RehabSession[]) {
  return sessionsForGraph(patientId, sessions)
    .slice()
    .reverse()
    .map((session) => ({
      date: session.startedAt.slice(0, 10),
      painBefore: session.painBefore ?? 0,
      painAfter: session.painAfter ?? 0,
      fatigueBefore: session.fatigueBefore ?? 0,
      fatigueAfter: session.fatigueAfter ?? 0
    }));
}

export function getImprovementPercent(patientId: string, sessions: RehabSession[]) {
  const ordered = sessionsForGraph(patientId, sessions).slice().reverse();
  if (ordered.length < 2) return 0;
  return Math.round((ordered[ordered.length - 1].accuracy ?? ordered[ordered.length - 1].averageAccuracy) - (ordered[0].accuracy ?? ordered[0].averageAccuracy));
}

export function getDifficultyRecommendation(patient: Patient, assignments: Assignment[], sessions: RehabSession[]) {
  const patientSessions = sessions.filter((session) => session.patientId === patient.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = patientSessions[0];
  const latestTwo = patientSessions.slice(0, 2);
  const adherence = getWeeklyCompletionRate(patient.id, assignments, sessions);

  if (latestTwo.length >= 2 && latestTwo.every((session) => (session.accuracy ?? session.averageAccuracy) >= 90)) {
    return { recommendation: "Consider increasing difficulty", reason: "Accuracy has been above 90% for two sessions." };
  }
  if (latest && (latest.accuracy ?? latest.averageAccuracy) < 60) {
    return { recommendation: "Consider lowering difficulty", reason: "Accuracy was below 60%." };
  }
  if (latest && (latest.painAfter ?? 0) - (latest.painBefore ?? 0) >= 3) {
    return { recommendation: "Keep or lower difficulty", reason: "Pain increased during the latest session." };
  }
  if (adherence < 50) {
    return { recommendation: "Consider shorter or easier exercises", reason: "Adherence is low." };
  }
  return { recommendation: "Continue current difficulty", reason: "Patient is progressing steadily." };
}

export function unresolvedAlerts(alerts: Alert[]) {
  return alerts.filter((alert) => !alert.resolved);
}
