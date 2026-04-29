import type {
  Appointment as ClinicAppointment,
  Assignment as ClinicAssignment,
  CheckIn,
  ExerciseTemplate,
  FingerName,
  GameId,
  Patient,
  PatientCareAppointment,
  PatientCareAssignment,
  RehabSession,
  SessionResult
} from "../types";
import { averageAccuracy, clampPercent } from "../lib/gesture";

const resultsStorageKey = "gloving.patient.sessionResults.v1";

const now = () => new Date();

function dayOffset(days: number, hour: number, minute = 0) {
  const date = now();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export const gameTutorials = {
  "ball-pickup": {
    title: "Ball Pickup",
    steps: [
      "Open your hand to relax before the rep.",
      "Point at the ball you want to pick up.",
      "Make a fist to grab the ball.",
      "Move your hand to the basket.",
      "Open your hand to release the ball into the basket."
    ]
  },
  "finger-tap-piano": {
    title: "Finger Tap Piano",
    steps: [
      "Tap Start—the board explains whether you are on Easy (classic keys), Medium (hold), or Hard (falling lanes).",
      "Easy: only tap or bend the highlighted key; wrong taps add a miss and zero the streak.",
      "Medium: hold the bend briefly on each cue; automatic rest breaks may appear.",
      "Hard (Lanes): rhythm notes drop toward the target band — tap only the lane that matches; wrong lanes or slips add misses.",
      "Reach the hit goal before misses or timer end (Hard Lanes)."
    ]
  },
  "bubble-pop": {
    title: "Bubble Pop",
    steps: [
      "Move your hand marker to a bubble.",
      "Point or pinch to pop the target bubble.",
      "Leave the red decoy bubbles alone.",
      "Pop the assigned number before time runs out."
    ]
  },
  "carrom-flick": {
    title: "Carrom",
    steps: [
      "Aim the striker from the baseline.",
      "Use a finger flick to launch the striker.",
      "Pocket your white coins before the AI pockets black.",
      "Watch for the red queen and control direction and force."
    ]
  }
} as const;

const KNOWN_GAME_IDS: GameId[] = ["ball-pickup", "finger-tap-piano", "bubble-pop", "carrom-flick"];

const DEFAULT_MINUTES: Record<GameId, number> = {
  "ball-pickup": 8,
  "finger-tap-piano": 6,
  "bubble-pop": 5,
  "carrom-flick": 6
};

function coerceGameId(id: string): GameId {
  return (KNOWN_GAME_IDS.includes(id as GameId) ? id : "ball-pickup") as GameId;
}

/** Map clinician assignments to the patient rehab game model. Only call with `status === "assigned"`. */
export function doctorAssignmentToPatientCare(assignment: ClinicAssignment): PatientCareAssignment {
  const gameId = coerceGameId(assignment.gameId);
  const reps = assignment.reps ?? null;
  const rounds = assignment.rounds ?? null;
  const targetReps =
    reps !== null && reps !== undefined && reps > 0
      ? reps
      : rounds !== null && rounds !== undefined && rounds > 0
        ? Math.max(6, rounds * 4)
        : 10;
  const configRounds =
    rounds !== null && rounds !== undefined && rounds > 0 ? rounds : Math.max(1, Math.round(targetReps / 5));

  const parts = assignment.targetSkill
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id: assignment.id,
    patientId: assignment.patientId,
    gameId,
    name: assignment.gameName,
    config: {
      targetReps,
      rounds: configRounds,
      frequency: assignment.frequency,
      difficulty: assignment.difficulty,
      estimatedMinutes: DEFAULT_MINUTES[gameId],
      targetSkills: parts.length > 0 ? parts : [assignment.targetSkill]
    },
    doctorInstructions:
      assignment.notes?.trim() ||
      `Complete your ${assignment.gameName} plan as prescribed. Contact your clinician if you have questions.`,
    doctorNotes: assignment.targetSkill,
    dueDate:
      assignment.dueDate.includes("T") ? assignment.dueDate : `${assignment.dueDate}T12:00:00.000Z`,
    status:
      assignment.status === "assigned"
        ? "assigned"
        : assignment.status === "completed"
          ? "completed"
          : "missed"
  };
}

export function doctorAssignmentsToPatientCare(assignments: ClinicAssignment[]): PatientCareAssignment[] {
  return assignments.filter((a) => a.status === "assigned").map(doctorAssignmentToPatientCare);
}

function combineClinicDateTime(datePart: string, timePart: string): string {
  const t = timePart.length === 5 ? `${timePart}:00` : timePart;
  if (datePart.includes("T")) return datePart;
  return `${datePart}T${t}`;
}

export function doctorAppointmentToPatientCare(appointment: ClinicAppointment): PatientCareAppointment {
  const status: PatientCareAppointment["status"] =
    appointment.status === "scheduled" ? "upcoming" : appointment.status === "completed" ? "completed" : "missed";

  return {
    id: appointment.id,
    patientId: appointment.patientId,
    startsAt: combineClinicDateTime(appointment.date, appointment.time),
    clinician: "Your care team",
    title: appointment.type,
    location: appointment.notes?.trim() || "Video or in-person — check with your clinic.",
    status
  };
}

/** Clinician Rehab Games sidebar uses this synthetic id — not a roster patient. */
export const DOCTOR_GAME_LIBRARY_PATIENT_ID = "doctor-game-library-demo";

/** Stand-in `Patient` for the clinician game library workspace (shows clinician name + catalog). */
export function createDoctorGameLibraryPatient(primaryClinicianDisplayName: string): Patient {
  return {
    id: DOCTOR_GAME_LIBRARY_PATIENT_ID,
    userId: `${DOCTOR_GAME_LIBRARY_PATIENT_ID}-preview`,
    doctorId: "doctor-1",
    name: primaryClinicianDisplayName,
    age: 0,
    diagnosis: "",
    condition: "",
    therapist: primaryClinicianDisplayName,
    status: "stable",
    goal: "Preview the Rehab Games catalog. Assign exercises from each patient's workspace.",
    recoveryGoal: "",
    affectedHand: "right",
    notes: "",
    baselineMobility: 50,
    sessions: []
  };
}

/** Full four-game catalog for the clinician library — ignores roster assignments (see `experienceMode="doctor-library"`). */
export function createDoctorGameLibraryAssignments(): PatientCareAssignment[] {
  return createPatientAssignments(DOCTOR_GAME_LIBRARY_PATIENT_ID).map((assignment) => ({
    ...assignment,
    doctorInstructions: `Demonstration (${assignment.name}). Assign from a patient's plan to put this game on their care plan.`,
    doctorNotes: "Library preview — not merged with a patient's chart."
  }));
}

export function createPatientAssignments(patientId: string): PatientCareAssignment[] {
  return [
    {
      id: `${patientId}-ball-pickup`,
      patientId,
      gameId: "ball-pickup",
      name: "Ball Pickup",
      config: {
        targetReps: 4,
        rounds: 2,
        frequency: "Daily",
        difficulty: "easy",
        estimatedMinutes: 6,
        targetSkills: ["Grip release", "Reach control", "Hand opening"]
      },
      doctorInstructions: "Move slowly and pause after each release. Stop if pain rises sharply.",
      doctorNotes: "Focus on clean open-hand release into the basket before adding speed.",
      dueDate: dayOffset(0, 18),
      status: "assigned"
    },
    {
      id: `${patientId}-finger-tap-piano`,
      patientId,
      gameId: "finger-tap-piano",
      name: "Finger Tap Piano",
      config: {
        targetReps: 10,
        rounds: 2,
        frequency: "Daily",
        difficulty: "medium",
        estimatedMinutes: 5,
        targetSkills: ["Finger isolation", "Tap timing", "Rhythm"]
      },
      doctorInstructions: "Tap only the prompted finger. Rest between rounds if the hand feels tired.",
      doctorNotes: "Ring and pinky isolation may be harder. Accuracy matters more than speed.",
      dueDate: dayOffset(0, 19),
      status: "assigned"
    },
    {
      id: `${patientId}-bubble-pop`,
      patientId,
      gameId: "bubble-pop",
      name: "Bubble Pop",
      config: {
        targetReps: 6,
        rounds: 2,
        frequency: "4x weekly",
        difficulty: "easy",
        estimatedMinutes: 5,
        targetSkills: ["Pointer control", "Pinch precision", "Visual tracking"]
      },
      doctorInstructions: "Use a small controlled point or pinch. Skip wrong-color bubbles.",
      doctorNotes: "Keep your shoulder relaxed while reaching across the screen.",
      dueDate: dayOffset(1, 18),
      status: "assigned"
    },
    {
      id: `${patientId}-carrom-flick`,
      patientId,
      gameId: "carrom-flick",
      name: "Carrom",
      config: {
        targetReps: 4,
        rounds: 2,
        frequency: "3x weekly",
        difficulty: "medium",
        estimatedMinutes: 6,
        targetSkills: ["Index extension", "Flick force", "Aim control"]
      },
      doctorInstructions: "Use a light flick. Do not force the finger if it feels stiff or painful.",
      doctorNotes: "Smooth aim and gentle force are the priority for this game.",
      dueDate: dayOffset(2, 17),
      status: "assigned"
    }
  ];
}

export function createPatientAppointments(patientId: string): PatientCareAppointment[] {
  return [
    {
      id: `${patientId}-appt-next`,
      patientId,
      startsAt: dayOffset(3, 10, 30),
      clinician: "Dr. Nguyen",
      title: "Therapy progress review",
      location: "Rehab Clinic Room 3",
      status: "upcoming"
    },
    {
      id: `${patientId}-appt-completed`,
      patientId,
      startsAt: dayOffset(-6, 11),
      clinician: "Dr. Nguyen",
      title: "Grip range check",
      location: "Video visit",
      status: "completed"
    }
  ];
}

export function createEmptyCheckIn(phase: CheckIn["phase"]): CheckIn {
  return {
    phase,
    pain: 0,
    fatigue: 0,
    recordedAt: new Date().toISOString()
  };
}

function readAllResults(): SessionResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(resultsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllResults(results: SessionResult[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(resultsStorageKey, JSON.stringify(results));
}

export function loadSessionResults(patientId: string): SessionResult[] {
  return readAllResults()
    .filter((result) => result.patientId === patientId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function saveSessionResultLocal(result: SessionResult): SessionResult {
  const saved = { ...result, savedAt: new Date().toISOString() };
  const next = [saved, ...readAllResults().filter((item) => item.id !== saved.id)];
  writeAllResults(next);
  return saved;
}

export function sessionResultToRehabSession(result: SessionResult): RehabSession {
  const bestFistScore = result.events
    .filter((event) => event.gesture === "fist")
    .reduce((best, event) => Math.max(best, event.accuracy), 0);

  return {
    id: result.id,
    patientId: result.patientId,
    assignmentId: result.assignmentId,
    gameId: result.gameId,
    gameName: result.gameName,
    exerciseId: result.assignmentId,
    exerciseName: result.gameName,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    repsCompleted: result.repsCompleted,
    targetReps: Math.max(result.repsCompleted, result.successfulReps + result.failedAttempts),
    averageAccuracy: result.accuracy || averageAccuracy(result.events),
    bestFistScore,
    fatigueWarnings:
      result.painAfter.fatigue - result.painBefore.fatigue >= 3 ||
      result.painAfter.pain - result.painBefore.pain >= 3
        ? 1
        : 0,
    notes: `${result.gameName}: ${result.encouragement} Pain ${result.painBefore.pain}->${result.painAfter.pain}, fatigue ${result.painBefore.fatigue}->${result.painAfter.fatigue}.`,
    events: result.events
  };
}

export function assignmentToExerciseTemplate(assignment: PatientCareAssignment): ExerciseTemplate {
  return {
    id: assignment.id,
    name: assignment.name,
    goal: assignment.config.targetSkills.join(", "),
    targetGesture: assignment.gameId === "bubble-pop" ? "pinch" : assignment.gameId === "carrom-flick" ? "flick" : "fist",
    durationMinutes: assignment.config.estimatedMinutes,
    targetReps: assignment.config.targetReps,
    difficulty: assignment.config.difficulty,
    instructions: assignment.doctorInstructions
  };
}

export function encouragementFor(result: {
  successfulReps: number;
  failedAttempts: number;
  accuracy: number;
  weakestFinger?: FingerName;
}) {
  if (result.successfulReps === 0) {
    return "You completed the session setup. Take a rest and try another short round when ready.";
  }
  if (result.accuracy >= 85) {
    return "Strong control today. Keep the same steady pace next session.";
  }
  if (result.failedAttempts > result.successfulReps) {
    return "Good effort. Slow the movement down and focus on one clean rep at a time.";
  }
  if (result.weakestFinger) {
    return `Nice work. Your ${result.weakestFinger} may need extra attention, so keep movements gentle and controlled.`;
  }
  return "Session complete. Consistent practice is building control.";
}

export function checkInIncreaseWarning(before: CheckIn, after: CheckIn) {
  const painIncrease = after.pain - before.pain;
  const fatigueIncrease = after.fatigue - before.fatigue;
  if (painIncrease >= 3 && fatigueIncrease >= 3) {
    return "Pain and fatigue both increased by 3 or more. Stop exercising for now and contact your clinician if this does not settle.";
  }
  if (painIncrease >= 3) {
    return "Pain increased by 3 or more. Stop exercising for now and contact your clinician if needed.";
  }
  if (fatigueIncrease >= 3) {
    return "Fatigue increased by 3 or more. Rest before continuing and contact your clinician if needed.";
  }
  return "";
}

export function completionRate(results: SessionResult[], assignments: PatientCareAssignment[]) {
  const assigned = Math.max(assignments.length, 1);
  const completedToday = new Set(
    results
      .filter((result) => new Date(result.startedAt).toDateString() === new Date().toDateString())
      .map((result) => result.assignmentId)
  );
  return clampPercent((completedToday.size / assigned) * 100);
}
