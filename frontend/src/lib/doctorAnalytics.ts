import type { Alert, Assignment, FingerName, GestureEvent, Patient, RehabSession } from "../types";

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
  const patientSessions = sessions.filter((session) => session.patientId === patientId);
  if (!patientSessions.length) return 0;
  return Math.round(patientSessions.reduce((sum, session) => sum + (session.accuracy ?? session.averageAccuracy), 0) / patientSessions.length);
}

export function getLatestAccuracy(patientId: string, sessions: RehabSession[]) {
  return [...sessions]
    .filter((session) => session.patientId === patientId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.accuracy ?? 0;
}

export function getAccuracyTrend(patientId: string, sessions: RehabSession[]) {
  return sessions
    .filter((session) => session.patientId === patientId)
    .slice()
    .reverse()
    .map((session) => ({ date: session.startedAt.slice(0, 10), accuracy: session.accuracy ?? session.averageAccuracy }));
}

export function getRepsTrend(patientId: string, sessions: RehabSession[]) {
  return sessions
    .filter((session) => session.patientId === patientId)
    .slice()
    .reverse()
    .map((session) => ({ date: session.startedAt.slice(0, 10), repsCompleted: session.repsCompleted }));
}

export function getPainFatigueTrend(patientId: string, sessions: RehabSession[]) {
  return sessions
    .filter((session) => session.patientId === patientId)
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
  const ordered = sessions.filter((session) => session.patientId === patientId).slice().reverse();
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
