import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Gauge,
  Hand,
  HandMetal,
  Heart,
  Layers,
  Link2,
  LogOut,
  Play,
  Pointer,
  Repeat,
  Save,
  Send,
  Sparkles,
  Settings,
  TrendingUp,
  Timer,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fingerNames, weakestFinger as weakestFingerFromEvents } from "../lib/gesture";
import type {
  CalibrationData,
  CheckIn,
  FingerBends,
  FingerName,
  GameId,
  GestureEvent,
  PatientCareAppointment,
  PatientCareAssignment,
  Patient,
  RehabSession,
  SessionResult
} from "../types";
import { PatientGame, type GamePlayResult, gameIcons } from "./PatientGames";
import { manifestForGame } from "./gameRegistry";
import { RehabGameCatalogArt, rehabGameCatalogTagline } from "./RehabGameCatalogArt";
import { AnimatedGamePreview } from "./AnimatedGamePreview";
import { PatientInputProvider, inputModeLabels, usePatientInput } from "./input";
import { averageRawSamples } from "./ballPickupGrip";
import {
  assessFingerTapCaptureQuality,
  buildFingerTapProfiles,
  type FingerTapCaptureQuality
} from "./fingerTapInput";
import { saveCalibration, savePatientSessionResult } from "./patientApi";
import { Canvas } from "@react-three/fiber";
import { HandModel3D } from "../vr/components/HandModel3D";
import {
  checkInIncreaseWarning,
  completionRate,
  createPatientAppointments,
  createPatientAssignments,
  encouragementFor,
  gameTutorials,
  loadSessionResults,
  saveSessionResultLocal,
  createDoctorGameLibraryAssignments,
  sessionResultToRehabSession
} from "./patientData";
import { fingerExercises, type ExerciseAssignment, type FingerExercise } from "../data/exercises";

export type PatientScreen = "home" | "calendar" | "progress" | "assistant";
export type PatientExerciseRouteStep = "detail" | "play" | "results";

type PatientRoute =
  | { step: "dashboard" }
  | { step: "detail"; assignmentId: string }
  | { step: "tutorial"; assignmentId: string }
  | { step: "calibration"; assignmentId: string }
  | { step: "pre-check"; assignmentId: string }
  | { step: "game"; assignmentId: string }
  | { step: "post-check"; assignmentId: string }
  | { step: "results"; assignmentId: string }
  | { step: "exercise-detail"; exerciseAssignmentId: string }
  | { step: "exercise-play"; exerciseAssignmentId: string }
  | { step: "exercise-results"; exerciseAssignmentId: string }
  | { step: "calendar" }
  | { step: "progress" }
  | { step: "assistant" };

type AssistantMessage = {
  id: string;
  role: "patient" | "assistant";
  text: string;
};

type PatientExerciseAssignment = ExerciseAssignment & {
  exercise: FingerExercise;
};

type ExercisePlayResult = {
  repsCompleted: number;
  targetReps: number;
  accuracy: number;
  timeTakenSeconds: number;
  completedAt: string;
};

const fingerLabels: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

const pregameInstructionSteps: Record<GameId, string[]> = {
  "ball-pickup": [
    "Open your hand to relax.",
    "Point at the target ball.",
    "Make a fist, move to the basket, release."
  ],
  "finger-tap-piano": [
    "Start when ready.",
    "Tap only the highlighted key.",
    "Rest if your hand feels tired."
  ],
  "bubble-pop": [
    "Move to a target bubble.",
    "Point or pinch to pop it.",
    "Avoid decoy bubbles."
  ],
  "carrom-flick": [
    "Aim from the baseline.",
    "Pull back to set power.",
    "Release with a light flick."
  ]
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function titleLabel(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function difficultyLabel(value: PatientCareAssignment["config"]["difficulty"]) {
  return titleLabel(value);
}

function recentPatientSessions(patient: Patient, results: SessionResult[]) {
  const resultSessions = results.map(sessionResultToRehabSession);
  const existingIds = new Set(resultSessions.map((session) => session.id));
  return [...resultSessions, ...patient.sessions.filter((session) => !existingIds.has(session.id))]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function streakDays(sessions: RehabSession[]) {
  const days = new Set(sessions.map((session) => new Date(session.startedAt).toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function averageBend(bends?: FingerBends) {
  if (!bends) return 0;
  return Math.round(fingerNames.reduce((sum, finger) => sum + bends[finger], 0) / fingerNames.length);
}

const CALIBRATION_TOTAL_STEPS = 9;
const CALIBRATION_HOLD_MS = 3000;
const CALIBRATION_SAMPLE_WARMUP_MS = 350;
const CALIBRATION_MIN_UNIQUE_SAMPLES = 6;

type CalibrationSample = {
  key: string;
  at: number;
  values: Record<string, number>;
};

function rawSampleKey(values: Record<string, number>) {
  return fingerNames.map((finger) => `${finger}:${Math.round(values[finger] ?? 0)}`).join("|");
}

function basicCaptureQuality(samples: Array<Record<string, number>>, averaged: FingerBends | null): FingerTapCaptureQuality {
  return {
    ok: Boolean(averaged) && samples.length >= CALIBRATION_MIN_UNIQUE_SAMPLES,
    status: samples.length >= CALIBRATION_MIN_UNIQUE_SAMPLES ? "stable" : "not-enough-samples",
    message: samples.length >= CALIBRATION_MIN_UNIQUE_SAMPLES ? "Stable calibration shape captured." : "Need more fresh glove frames. Hold steady and try again.",
    sampleCount: samples.length,
    signal: averaged ? averageBend(averaged) : 0,
    stability: 100
  };
}

function calibrationCapturedCount(steps: CalibrationData["steps"], fingerTaps: CalibrationData["fingerTaps"]) {
  let n = 0;
  if (steps.open) n += 1;
  if (steps.fist) n += 1;
  if (steps.point) n += 1;
  if (steps.pinch) n += 1;
  for (const f of fingerNames) if (fingerTaps[f]) n += 1;
  return n;
}

/** Next incomplete gesture or finger tap, for guided “next step” emphasis */
function recommendedCalibrationTarget(
  steps: CalibrationData["steps"],
  fingerTaps: CalibrationData["fingerTaps"]
): "open" | "fist" | "point" | "pinch" | FingerName | null {
  if (!steps.open) return "open";
  if (!steps.fist) return "fist";
  if (!steps.point) return "point";
  if (!steps.pinch) return "pinch";
  for (const f of fingerNames) if (!fingerTaps[f]) return f;
  return null;
}

type CalibrationTarget =
  | { id: string; kind: "step"; step: keyof CalibrationData["steps"]; label: string }
  | { id: string; kind: "finger"; finger: FingerName; label: string };

type CalibrationRunPhase = "idle" | "prepare" | "hold" | "captured" | "retry" | "complete";

function calibrationGestureMeta(step: keyof CalibrationData["steps"]) {
  return CALIBRATION_GESTURES.find((gesture) => gesture.key === step);
}

function CalibrationGloveHeroArt() {
  return (
    <svg className="cal-hero-art-svg" viewBox="0 0 140 148" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="calGloveGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#99f6e4" stopOpacity={0.8} />
          <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0.35} />
        </linearGradient>
        <linearGradient id="calGloveFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ecfdf5" />
          <stop offset="100%" stopColor="#e0f2fe" />
        </linearGradient>
      </defs>
      <ellipse cx="70" cy="82" rx="56" ry="62" fill="url(#calGloveGlow)" opacity={0.45} />
      <path
        d="M 46 118 C 40 104 41 74 54 62 C 60 54 74 54 82 62 C 90 74 93 106 82 126 C 76 132 62 134 54 126 C 48 120 46 118 46 118 Z"
        fill="url(#calGloveFill)"
        stroke="#0f766e"
        strokeOpacity={0.2}
        strokeWidth="1.2"
      />
      <path d="M 56 118 L56 112 C52 98 53 74 61 62" stroke="#14b8a6" strokeOpacity={0.35} strokeWidth="1.2" fill="none" />
      <path d="M 66 126 L67 114 C62 94 61 74 71 61" stroke="#14b8a6" strokeOpacity={0.45} strokeWidth="1.2" fill="none" />
      <path d="M 78 123 L76 114 C71 93 71 73 82 61" stroke="#14b8a6" strokeOpacity={0.45} strokeWidth="1.2" fill="none" />
      <circle cx="70" cy="48" r="16" stroke="#2563eb" strokeOpacity={0.3} strokeWidth="1.4" fill="rgba(219,234,254,0.85)" />
      <path d="M 46 118 L92 118" stroke="#94a3b8" strokeOpacity={0.35} strokeWidth="2" strokeLinecap="round" />
      <circle cx="70" cy="28" r="4" fill="#2563eb" fillOpacity={0.35} />
      <circle cx="70" cy="28" r="9" stroke="#2563eb" strokeOpacity={0.2} strokeWidth="1" fill="none" />
    </svg>
  );
}

function CheckInWellnessArt({ phase }: { phase: CheckIn["phase"] }) {
  const warm = phase === "post";
  const accent = warm ? "#6366f1" : "#0d9488";
  return (
    <svg className="checkin-wellness-svg" viewBox="0 0 136 136" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="checkinBlob" x1="14%" y1="0%" x2="86%" y2="100%">
          <stop offset="0%" stopColor={warm ? "#e0e7ff" : "#ccfbf1"} />
          <stop offset="100%" stopColor={warm ? "#f5f3ff" : "#dbeafe"} />
        </linearGradient>
        <linearGradient id="checkinHeartStroke" x1="40%" y1="0%" x2="60%" y2="100%">
          <stop offset="0%" stopColor={warm ? "#a5b4fc" : "#5eead4"} />
          <stop offset="100%" stopColor={warm ? "#6366f1" : "#14b8a6"} />
        </linearGradient>
      </defs>
      <circle cx="68" cy="68" r="56" fill="url(#checkinBlob)" />
      <ellipse cx="68" cy="74" rx="32" ry="40" transform="rotate(-5 68 74)" fill="rgba(255,255,255,0.9)" stroke={accent} strokeOpacity={0.15} strokeWidth="1.15" />
      <circle cx="36" cy="96" r="20" stroke={accent} strokeOpacity={0.12} strokeWidth="3" strokeDasharray="9 18" fill="none" />
      <path
        d="M68 36 C58 24 44 32 44 48 C44 60 68 80 68 80 C68 80 92 60 92 48 C92 32 78 24 68 36 Z"
        fill="none"
        stroke="url(#checkinHeartStroke)"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const CALIBRATION_GESTURES = [
  {
    key: "open" as const,
    label: "Open hand",
    hint: "Hold your palm open — relaxed fingers, not stiff.",
    Icon: Hand,
    palette: "teal"
  },
  {
    key: "fist" as const,
    label: "Fist",
    hint: "Make a comfortable fist — steady, not forced.",
    Icon: HandMetal,
    palette: "indigo"
  },
  {
    key: "point" as const,
    label: "Point",
    hint: "Extend your index; let the other fingers soften.",
    Icon: Pointer,
    palette: "sky"
  },
  {
    key: "pinch" as const,
    label: "Pinch",
    hint: "Bring thumb and fingertip together in a light pinch.",
    Icon: Link2,
    palette: "amber"
  }
] as const;

export function PatientExperience({
  patient,
  screen,
  currentEvent,
  backendConnected,
  onSessionSaved,
  assignedGames,
  assignedExercises,
  clinicAppointments,
  onLogout,
  onNavigateScreen,
  exerciseRoute,
  onNavigateExercise,
  experienceMode = "patient"
}: {
  patient: Patient;
  screen: PatientScreen;
  currentEvent: GestureEvent;
  backendConnected: boolean;
  onSessionSaved: (session: RehabSession) => void;
  /** When set (including []), replaces mock demo assignments — use clinician-assigned games for this patient only. */
  assignedGames?: PatientCareAssignment[];
  assignedExercises?: ExerciseAssignment[];
  /** When set (including []), replaces mock demo appointments. */
  clinicAppointments?: PatientCareAppointment[];
  /** Clinician Rehab Games sidebar: full catalog preview, disconnected from roster patient assignments. */
  experienceMode?: "patient" | "doctor-library";
  onLogout?: () => void;
  onNavigateScreen?: (screen: PatientScreen) => void;
  exerciseRoute?: { assignmentId: string; step: PatientExerciseRouteStep } | null;
  onNavigateExercise?: (assignmentId: string, step: PatientExerciseRouteStep) => void;
}) {
  const [route, setRoute] = useState<PatientRoute>({ step: "dashboard" });
  const [results, setResults] = useState<SessionResult[]>(() => loadSessionResults(patient.id));
  const [calibration, setCalibration] = useState<CalibrationData | undefined>();
  const [preCheck, setPreCheck] = useState<CheckIn | undefined>();
  const [postCheck, setPostCheck] = useState<CheckIn | undefined>();
  const [gameResult, setGameResult] = useState<GamePlayResult | undefined>();
  const [exerciseResult, setExerciseResult] = useState<ExercisePlayResult | undefined>();
  const [sessionStartedAt, setSessionStartedAt] = useState("");
  const [sessionEndedAt, setSessionEndedAt] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  const assignments = useMemo(() => {
    if (experienceMode === "doctor-library") return createDoctorGameLibraryAssignments();
    if (assignedGames !== undefined) return assignedGames;
    return createPatientAssignments(patient.id);
  }, [experienceMode, assignedGames, patient.id]);

  const appointments = useMemo(() => {
    if (experienceMode === "doctor-library") return [];
    if (clinicAppointments !== undefined) return clinicAppointments;
    return createPatientAppointments(patient.id);
  }, [experienceMode, clinicAppointments, patient.id]);

  const exercisePlan = useMemo<PatientExerciseAssignment[]>(() => {
    if (experienceMode === "doctor-library") return [];
    return (assignedExercises ?? []).flatMap((assignment) => {
      const exercise = fingerExercises.find((item) => item.id === assignment.exerciseId);
      return exercise ? [{ ...assignment, exercise }] : [];
    });
  }, [assignedExercises, experienceMode]);

  useEffect(() => {
    setResults(loadSessionResults(patient.id));
    if (exerciseRoute) {
      setRoute({
        step:
          exerciseRoute.step === "play"
            ? "exercise-play"
            : exerciseRoute.step === "results"
              ? "exercise-results"
              : "exercise-detail",
        exerciseAssignmentId: exerciseRoute.assignmentId
      });
      return;
    }
    setRoute({
      step: screen === "calendar" ? "calendar" : screen === "assistant" ? "assistant" : screen === "progress" ? "progress" : "dashboard"
    });
  }, [exerciseRoute, patient.id, screen]);

  const goToPatientScreen = (nextScreen: PatientScreen) => {
    onNavigateScreen?.(nextScreen);
    setRoute({ step: nextScreen === "home" ? "dashboard" : nextScreen });
  };

  const goToExercise = (assignmentId: string, step: PatientExerciseRouteStep) => {
    onNavigateExercise?.(assignmentId, step);
    setRoute({
      step: step === "play" ? "exercise-play" : step === "results" ? "exercise-results" : "exercise-detail",
      exerciseAssignmentId: assignmentId
    });
  };

  const selectedAssignment: PatientCareAssignment | undefined =
    assignments.length === 0
      ? undefined
      : "assignmentId" in route
        ? assignments.find((assignment) => assignment.id === route.assignmentId) ?? assignments[0]
        : assignments[0];
  const selectedExerciseAssignment: PatientExerciseAssignment | undefined =
    exercisePlan.length === 0
      ? undefined
      : "exerciseAssignmentId" in route
        ? exercisePlan.find((assignment) => assignment.id === route.exerciseAssignmentId) ?? exercisePlan[0]
        : exercisePlan[0];
  const selectedGameManifest = selectedAssignment ? manifestForGame(selectedAssignment.gameId) : null;
  const openFistOnlyInput = selectedAssignment?.gameId === "ball-pickup";
  const gloveMode = selectedGameManifest?.gloveMode ?? "default";

  const routeStep = route.step;
  const routeAnchor = "assignmentId" in route ? `${route.step}:${route.assignmentId}` : route.step;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [routeAnchor]);

  useEffect(() => {
    if (assignments.length > 0) return;
    if (routeStep === "dashboard" || routeStep === "calendar" || routeStep === "progress" || routeStep === "assistant") return;
    setRoute({ step: "dashboard" });
  }, [assignments.length, routeStep]);

  const beginAssignment = (assignmentId: string, step: PatientRoute["step"] = "detail") => {
    if (step === "detail") setRoute({ step: "detail", assignmentId });
    if (step === "tutorial") setRoute({ step: "tutorial", assignmentId });
    if (step === "calibration") setRoute({ step: "calibration", assignmentId });
  };

  const resetSessionState = () => {
    setCalibration(undefined);
    setPreCheck(undefined);
    setPostCheck(undefined);
    setGameResult(undefined);
    setExerciseResult(undefined);
    setSessionStartedAt("");
    setSessionEndedAt("");
    setSaveState("idle");
    setSaveMessage("");
  };

  const startQuickTestGame = (assignment: PatientCareAssignment) => {
    const open = { thumb: 5, index: 5, middle: 5, ring: 5, pinky: 5 };
    const fist = { thumb: 88, index: 92, middle: 92, ring: 90, pinky: 88 };
    const rawFromPercent = (percentBends: FingerBends): FingerBends =>
      fingerNames.reduce<FingerBends>(
        (acc, finger) => {
          acc[finger] = Math.round(open[finger] + ((fist[finger] - open[finger]) * percentBends[finger]) / 100);
          return acc;
        },
        { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }
      );
    const fingerTaps = {
      thumb: rawFromPercent({ thumb: 86, index: 28, middle: 10, ring: 8, pinky: 8 }),
      index: rawFromPercent({ thumb: 22, index: 88, middle: 30, ring: 10, pinky: 8 }),
      middle: rawFromPercent({ thumb: 10, index: 28, middle: 90, ring: 34, pinky: 12 }),
      ring: rawFromPercent({ thumb: 8, index: 12, middle: 42, ring: 88, pinky: 58 }),
      pinky: rawFromPercent({ thumb: 8, index: 8, middle: 14, ring: 66, pinky: 86 })
    };
    resetSessionState();
    setCalibration({
      id: `test-calibration-${Date.now()}`,
      patientId: patient.id,
      assignmentId: assignment.id,
      inputMode: "glove",
      completedAt: new Date().toISOString(),
      steps: {
        open,
        fist,
        point: { thumb: 18, index: 8, middle: 68, ring: 72, pinky: 76 },
        pinch: { thumb: 42, index: 45, middle: 18, ring: 16, pinky: 14 }
      },
      fingerTaps,
      fingerTapProfiles: buildFingerTapProfiles(open, fist, fingerTaps),
      thresholds: {
        openAverage: averageBend(open),
        fistAverage: averageBend(fist),
        pinchIndexGap: 3
      }
    });
    setPreCheck({ phase: "pre", pain: 0, fatigue: 0, recordedAt: new Date().toISOString() });
    setSessionStartedAt(new Date().toISOString());
    setRoute({ step: "game", assignmentId: assignment.id });
  };

  const saveCurrentResult = async () => {
    if (!selectedAssignment || !gameResult || !preCheck || !postCheck) return;
    setSaveState("saving");
    const weakestFinger = gameResult.weakestFinger ?? (gameResult.events.length ? weakestFingerFromEvents(gameResult.events) : undefined);
    const result: SessionResult = {
      id: `patient-session-${Date.now()}`,
      patientId: patient.id,
      assignmentId: selectedAssignment.id,
      gameId: selectedAssignment.gameId,
      gameName: selectedAssignment.name,
      startedAt: sessionStartedAt || new Date(Date.now() - gameResult.timeTakenSeconds * 1000).toISOString(),
      endedAt: sessionEndedAt || new Date().toISOString(),
      repsCompleted: gameResult.repsCompleted,
      successfulReps: gameResult.successfulReps,
      failedAttempts: gameResult.failedAttempts,
      accuracy: gameResult.accuracy,
      timeTakenSeconds: gameResult.timeTakenSeconds,
      gameMetrics: gameResult.gameMetrics,
      inputMode: calibration?.inputMode ?? "glove",
      weakestFinger,
      painBefore: preCheck,
      painAfter: postCheck,
      calibration,
      events: gameResult.events,
      encouragement: encouragementFor({ ...gameResult, weakestFinger })
    };

    try {
      if (experienceMode === "doctor-library") {
        const savedLocal = saveSessionResultLocal(result);
        setResults((items) => [savedLocal, ...items.filter((item) => item.id !== savedLocal.id)]);
        setSaveState("saved");
        setSaveMessage(
          "Preview saved in this browser only. It does not update a patient's chart or appear on clinicians' dashboards."
        );
      } else {
        const saved = await savePatientSessionResult(result, selectedAssignment, backendConnected);
        setResults((items) => [saved.result, ...items.filter((item) => item.id !== saved.result.id)]);
        onSessionSaved(sessionResultToRehabSession(saved.result));
        setSaveState("saved");
        setSaveMessage(saved.backendSaved ? "Saved to backend and local demo history." : "Saved locally for the patient demo.");
      }
    } catch {
      setSaveState("error");
      setSaveMessage("Could not save the session. Try again before leaving this page.");
    }
  };

  const content = (() => {
    if (route.step === "calendar") {
      return (
        <PatientCalendar
          patient={patient}
          assignments={assignments}
          appointments={appointments}
          results={results}
          experienceMode={experienceMode}
        />
      );
    }
    if (route.step === "assistant") {
      return <PatientAssistant patient={patient} assignments={assignments} results={results} experienceMode={experienceMode} />;
    }
    if (route.step === "progress") {
      return <PatientRecoveryProgress patient={patient} assignments={assignments} results={results} />;
    }

    if (route.step === "exercise-detail" || route.step === "exercise-play" || route.step === "exercise-results") {
      if (!selectedExerciseAssignment) {
        return (
          <section className="page-stack patient-dashboard">
            <div className="patient-hero">
              <div>
                <span className="eyebrow">Your exercises</span>
                <h2>No exercises assigned</h2>
                <p>Your care team has not assigned any finger exercises yet.</p>
              </div>
            </div>
          </section>
        );
      }

      if (route.step === "exercise-detail") {
        return (
          <PatientExerciseDetail
            assignment={selectedExerciseAssignment}
            onBack={() => goToPatientScreen("home")}
            onStart={() => {
              setExerciseResult(undefined);
              goToExercise(selectedExerciseAssignment.id, "play");
            }}
          />
        );
      }

      if (route.step === "exercise-play") {
        return (
          <PatientExerciseSession
            assignment={selectedExerciseAssignment}
            onBack={() => goToExercise(selectedExerciseAssignment.id, "detail")}
            onComplete={(result) => {
              setExerciseResult(result);
              goToExercise(selectedExerciseAssignment.id, "results");
            }}
          />
        );
      }

      return (
        <PatientExerciseResults
          assignment={selectedExerciseAssignment}
          result={exerciseResult}
          onReplay={() => {
            setExerciseResult(undefined);
            goToExercise(selectedExerciseAssignment.id, "play");
          }}
          onDashboard={() => goToPatientScreen("home")}
        />
      );
    }

    const stepNeedsAssignment =
      route.step === "detail" ||
      route.step === "tutorial" ||
      route.step === "calibration" ||
      route.step === "pre-check" ||
      route.step === "game" ||
      route.step === "post-check" ||
      route.step === "results";

    if (stepNeedsAssignment && (!selectedAssignment || assignments.length === 0)) {
      return (
        <section className="page-stack patient-dashboard">
          <div className="patient-hero">
            <div>
              <span className="eyebrow">Your games</span>
              <h2>No exercises assigned</h2>
              <p>
                Your care team has not placed any rehab games on your plan yet — or they may all be marked complete. Check
                back after your clinician assigns new activities.
              </p>
            </div>
          </div>
          <EmptyState
            title="Nothing on your plan yet"
            detail="Only games your clinician assigns to you will show up here. Ask your clinic to add exercises to your care plan."
          />
        </section>
      );
    }

    const a = selectedAssignment!;

    if (route.step === "detail") {
      return (
        <AssignmentDetail
          assignment={a}
          onBack={() => setRoute({ step: "dashboard" })}
          onCalibration={() => {
            resetSessionState();
            setRoute({ step: "calibration", assignmentId: a.id });
          }}
          onQuickPlay={() => startQuickTestGame(a)}
        />
      );
    }
    if (route.step === "tutorial") {
      return (
        <TutorialPage
          assignment={a}
          onBack={() => setRoute({ step: "detail", assignmentId: a.id })}
          onContinue={() => {
            resetSessionState();
            setRoute({ step: "calibration", assignmentId: a.id });
          }}
        />
      );
    }
    if (route.step === "calibration") {
      return (
        <CalibrationScreen
          assignment={a}
          onBack={() => setRoute({ step: "detail", assignmentId: a.id })}
          onComplete={(value) => {
            setCalibration(value);
            setRoute({ step: "pre-check", assignmentId: a.id });
          }}
          onSkip={() => startQuickTestGame(a)}
        />
      );
    }
    if (route.step === "pre-check") {
      return (
        <PainFatigueCheckIn
          title="Before You Play"
          phase="pre"
          backLabel="Back to Setup"
          onBack={() => setRoute({ step: "calibration", assignmentId: a.id })}
          onSubmit={(value) => {
            setPreCheck(value);
            setSessionStartedAt(new Date().toISOString());
            setRoute({ step: "game", assignmentId: a.id });
          }}
        />
      );
    }
    if (route.step === "game") {
      return (
        <PatientGame
          assignment={a}
          onComplete={(value) => {
            setGameResult(value);
            setSessionEndedAt(new Date().toISOString());
            setRoute({ step: "post-check", assignmentId: a.id });
          }}
        />
      );
    }
    if (route.step === "post-check") {
      return (
        <PainFatigueCheckIn
          title="After the Game"
          phase="post"
          before={preCheck}
          backLabel="Back to Game"
          onBack={() => setRoute({ step: "game", assignmentId: a.id })}
          onSubmit={(value) => {
            setPostCheck(value);
            setRoute({ step: "results", assignmentId: a.id });
          }}
        />
      );
    }
    if (route.step === "results") {
      return (
        <ResultsPage
          assignment={a}
          preCheck={preCheck}
          postCheck={postCheck}
          calibration={calibration}
          gameResult={gameResult}
          saveState={saveState}
          saveMessage={saveMessage}
          onSave={saveCurrentResult}
          onDashboard={() => setRoute({ step: "dashboard" })}
        />
      );
    }

    return (
        <PatientDashboard
          patient={patient}
          assignments={assignments}
          exerciseAssignments={exercisePlan}
          appointments={appointments}
          results={results}
          experienceMode={experienceMode}
          onOpenAssignment={(assignmentId) => beginAssignment(assignmentId)}
          onOpenExercise={(exerciseAssignmentId) => goToExercise(exerciseAssignmentId, "detail")}
        />
    );
  })();

  return (
    <PatientInputProvider
      patientId={patient.id}
      smartGloveEvent={currentEvent}
      calibration={calibration}
      openFistOnly={openFistOnlyInput}
      gloveMode={gloveMode}
      sessionId={"assignmentId" in route ? route.assignmentId : undefined}
    >
      <section className={`patient-experience patient-experience--${experienceMode}`}>
        {experienceMode === "doctor-library" ? (
          content
        ) : (
          <PatientPortalShell
            patient={patient}
            activeRoute={route.step}
            onHome={() => goToPatientScreen("home")}
            onCalendar={() => goToPatientScreen("calendar")}
            onProgress={() => goToPatientScreen("progress")}
            onAssistant={() => goToPatientScreen("assistant")}
            onLogout={onLogout}
          >
            {content}
          </PatientPortalShell>
        )}
      </section>
    </PatientInputProvider>
  );
}

function PatientPortalShell({
  patient,
  activeRoute,
  onHome,
  onCalendar,
  onProgress,
  onAssistant,
  children,
  onLogout
}: {
  patient: Patient;
  activeRoute: PatientRoute["step"];
  onHome: () => void;
  onCalendar: () => void;
  onProgress: () => void;
  onAssistant: () => void;
  children: React.ReactNode;
  onLogout?: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const activeNav =
    activeRoute === "calendar"
      ? "calendar"
      : activeRoute === "progress"
        ? "progress"
        : activeRoute === "assistant"
          ? "assistant"
          : "plan";

  useEffect(() => {
    if (!settingsOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (settingsRef.current?.contains(event.target as Node)) return;
      setSettingsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  return (
    <div className="patient-portal-shell">
      <aside className="patient-portal-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">
            <Activity size={21} />
          </div>
          <div>
            <strong>Dextera</strong>
            <span>Patient portal</span>
          </div>
        </div>
        <nav className="patient-side-nav" aria-label="Patient navigation">
          <button type="button" className={activeNav === "plan" ? "active" : ""} onClick={onHome}>
            <ClipboardList size={19} />
            Plan
          </button>
          <button type="button" className={activeNav === "calendar" ? "active" : ""} onClick={onCalendar}>
            <CalendarDays size={19} />
            Calendar
          </button>
          <button type="button" className={activeNav === "progress" ? "active" : ""} onClick={onProgress}>
            <TrendingUp size={19} />
            Recovery Progress
          </button>
          <button type="button" className={activeNav === "assistant" ? "active" : ""} onClick={onAssistant}>
            <Bot size={19} />
            Assistant
          </button>
        </nav>
      </aside>

      <main className="patient-portal-workspace">
        <header className="patient-portal-topbar">
          <div>
            <span className="eyebrow">Patient workspace</span>
            <strong>{patient.name}</strong>
            <p>{patient.recoveryGoal || patient.goal || "Guided home rehab plan"}</p>
          </div>
          <div className="settings-menu" ref={settingsRef}>
            <button
              className="icon-button settings-menu-trigger"
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              title="Settings"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
            >
              <Settings size={18} />
            </button>
            {settingsOpen ? (
              <div className="settings-dropdown patient-settings-dropdown" role="menu" aria-label="Patient settings menu">
                {onLogout ? (
                  <button type="button" role="menuitem" className="settings-dropdown-danger" onClick={onLogout}>
                    <LogOut size={17} />
                    Exit
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function PatientDashboard({
  patient,
  assignments,
  exerciseAssignments,
  appointments,
  results,
  experienceMode,
  onOpenAssignment,
  onOpenExercise
}: {
  patient: Patient;
  assignments: PatientCareAssignment[];
  exerciseAssignments: PatientExerciseAssignment[];
  appointments: PatientCareAppointment[];
  results: SessionResult[];
  experienceMode: "patient" | "doctor-library";
  onOpenAssignment: (assignmentId: string) => void;
  onOpenExercise: (exerciseAssignmentId: string) => void;
}) {
  const sessions = recentPatientSessions(patient, results);
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklySessions = sessions.filter((session) => new Date(session.startedAt).getTime() >= weekStart);
  const weeklyReps = weeklySessions.reduce((sum, session) => sum + session.repsCompleted, 0);
  const upcomingAppointment = appointments.find((appointment) => appointment.status === "upcoming");
  const streak = streakDays(sessions);
  const latestResult = results[0];
  const completionToday = completionRate(results, assignments);

  if (experienceMode === "doctor-library") {
    return (
      <section className="page-stack rehab-games-doctor-page" aria-labelledby="rg-page-title">
        <div className="rg-library-shell">
          <header className="rg-library-head">
            <h2 id="rg-page-title">Rehab Games</h2>
            <p>Choose a game to preview.</p>
          </header>

          {assignments.length === 0 ? (
            <EmptyState title="No games available" detail="Game previews will appear here when the catalog is loaded." />
          ) : (
            <div className="rg-catalog-grid">
              {assignments.map((assignment) => {
                const gid = assignment.gameId as GameId;
                return (
                  <article className={`rg-game-card rg-game-card--theme-${gid}`} key={assignment.id}>
                    <div className="rg-game-card__viz" aria-hidden>
                      <RehabGameCatalogArt gameId={gid} />
                    </div>
                    <div className="rg-game-card__body">
                      <h3 className="rg-game-card__title">{assignment.name}</h3>
                      <p className="rg-game-desc">{rehabGameCatalogTagline(gid)}</p>
                      <div className="rg-game-meta" aria-label={`${assignment.name} details`}>
                        <span>{assignment.config.targetReps} reps</span>
                        <span>{difficultyLabel(assignment.config.difficulty)}</span>
                        <span>{assignment.config.frequency.toLowerCase()}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="primary-button rg-game-card__link"
                      onClick={() => onOpenAssignment(assignment.id)}
                    >
                      <Play size={16} aria-hidden />
                      View
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="page-stack patient-dashboard">
      <div className="patient-hero">
        <div>
          <span className="eyebrow">Patient Home</span>
          <h2>{`Hello, ${patient.name}`}</h2>
          <p>
            Choose an assigned game. We will guide you through setup, check-in, play, and results.
          </p>
        </div>
        {assignments[0] && (
          <button type="button" className="primary-button" onClick={() => onOpenAssignment(assignments[0].id)}>
            <Play size={18} />
            Start Rehab
          </button>
        )}
      </div>

      <div className="patient-metric-grid">
        <article className="metric-card tone-teal">
          <div className="metric-icon"><CheckCircle2 size={20} /></div>
          <span>Today</span>
          <strong>{completionToday}%</strong>
          <small>Assigned games finished</small>
        </article>
        <article className="metric-card tone-blue">
          <div className="metric-icon"><Gauge size={20} /></div>
          <span>Weekly Progress</span>
          <strong>{weeklyReps}</strong>
          <small>Reps in last 7 days</small>
        </article>
        <article className="metric-card tone-amber">
          <div className="metric-icon"><Sparkles size={20} /></div>
          <span>Streak</span>
          <strong>{streak}</strong>
          <small>Days practiced</small>
        </article>
        <article className="metric-card tone-violet">
          <div className="metric-icon"><CalendarDays size={20} /></div>
          <span>Next Visit</span>
          <strong>{upcomingAppointment ? formatDate(upcomingAppointment.startsAt) : "None"}</strong>
          <small>{upcomingAppointment?.clinician ?? "No appointment scheduled"}</small>
        </article>
      </div>

      <div className="two-column patient-main-grid">
        <article className="surface">
          <div className="section-title">
            <h3>Today&apos;s Rehab Plan</h3>
            <span>{assignments.length} Games</span>
          </div>
          {assignments.length === 0 ? (
            <EmptyState title="No assignments today" detail="Your clinician has not assigned exercises for today." />
          ) : (
            <div className="assignment-grid">
              {assignments.map((assignment) => {
                const Icon = gameIcons[assignment.gameId];
                const completed = results.some((result) => result.assignmentId === assignment.id);
                return (
                  <article className="assignment-card" key={assignment.id}>
                    <div className="assignment-card-top">
                      <div className="assignment-icon"><Icon size={20} /></div>
                      <span className={`status-pill ${completed ? "status-active" : "status-review"}`}>
                        {completed ? "Completed" : "Due"}
                      </span>
                    </div>
                    <h3>{assignment.name}</h3>
                    <p>{assignment.config.targetSkills.join(", ")}</p>
                    <div className="assignment-meta">
                      <span>{assignment.config.targetReps} Reps</span>
                      <span>{assignment.config.rounds} Rounds</span>
                      <span>{assignment.config.frequency}</span>
                      <span>{difficultyLabel(assignment.config.difficulty)}</span>
                    </div>
                    <div className="assignment-actions">
                      <button type="button" className="secondary-button" onClick={() => onOpenAssignment(assignment.id)}>
                        View Details
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="surface">
          <div className="section-title">
            <h3>Finger Exercises</h3>
            <span>{exerciseAssignments.length} Drills</span>
          </div>
          {exerciseAssignments.length === 0 ? (
            <EmptyState title="No finger exercises assigned" detail="Assigned finger drills will appear here." />
          ) : (
            <div className="assignment-grid exercise-plan-grid">
              {exerciseAssignments.map((assignment) => {
                const exercise = assignment.exercise;
                return (
                  <article className="assignment-card exercise-plan-card" key={assignment.id}>
                    <div className="assignment-card-top">
                      <div className="assignment-icon"><Hand size={20} /></div>
                      <span className="status-pill status-review">Due</span>
                    </div>
                    <h3>{exercise.name}</h3>
                    <p>{exercise.description}</p>
                    <div className="assignment-meta">
                      <span>{exercise.reps} Reps</span>
                      <span>{exercise.fingers.map((finger) => fingerLabels[finger]).join(" + ")}</span>
                      <span>{difficultyLabel(exercise.difficulty)}</span>
                    </div>
                    <div className="assignment-actions">
                      <button type="button" className="secondary-button" onClick={() => onOpenExercise(assignment.id)}>
                        View Details
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <aside className="surface patient-side-panel">
          <div className="section-title">
            <h3>Doctor Notes</h3>
            <span>{patient.therapist}</span>
          </div>
          <p className="care-goal">{assignments[0]?.doctorNotes ?? patient.goal}</p>
          <div className="calendar-mini">
            <strong>Upcoming Appointment</strong>
            <span>{upcomingAppointment ? formatDateTime(upcomingAppointment.startsAt) : "No upcoming appointment"}</span>
            <small>{upcomingAppointment ? `${upcomingAppointment.title} · ${upcomingAppointment.location}` : "Check back after your next clinic update."}</small>
          </div>
          <div className="calendar-mini">
            <strong>Latest Result</strong>
            <span>{latestResult ? `${latestResult.gameName} · ${latestResult.accuracy}%` : "No patient game completed yet"}</span>
            <small>{latestResult ? formatDateTime(latestResult.startedAt) : "Complete Ball Pickup to see progress here."}</small>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PatientExerciseDetail({
  assignment,
  onBack,
  onStart
}: {
  assignment: PatientExerciseAssignment;
  onBack: () => void;
  onStart: () => void;
}) {
  const exercise = assignment.exercise;
  const setupSteps = [
    { label: "Review", Icon: ClipboardList },
    { label: "Practice", Icon: Hand },
    { label: "Results", Icon: CheckCircle2 }
  ];
  return (
    <section className="page-stack patient-exercise-detail">
      <BackButton onBack={onBack} label="Plan" />
      <header className="pregame-hero patient-exercise-hero" aria-labelledby="exercise-title">
        <div className="pregame-hero-grid">
          <div className="pregame-hero-copy">
            <span className="eyebrow">Finger exercise</span>
            <h2 className="pregame-hero-title" id="exercise-title">{exercise.name}</h2>
            <p className="pregame-hero-sub">{exercise.description}</p>
            <div className="pregame-chip-row" aria-label="Exercise parameters">
              <span className="pregame-chip pregame-chip--reps">
                <Repeat size={14} strokeWidth={2.25} aria-hidden /> {exercise.reps} reps
              </span>
              <span className="pregame-chip pregame-chip--level">
                <Gauge size={14} strokeWidth={2.25} aria-hidden /> {difficultyLabel(exercise.difficulty)}
              </span>
              <span className="pregame-chip pregame-chip--schedule">
                <Hand size={14} strokeWidth={2.25} aria-hidden /> {exercise.fingers.map((finger) => fingerLabels[finger]).join(" + ")}
              </span>
            </div>
            <div className="pregame-hero-actions">
              <button type="button" className="primary-button pregame-hero-cta" onClick={onStart}>
                <Play size={18} />
                Start Exercise
              </button>
            </div>
          </div>
          <aside className="patient-exercise-preview" aria-hidden>
            {fingerNames.map((finger) => (
              <span key={finger} className={exercise.fingers.includes(finger) ? "is-target" : ""}>
                {fingerLabels[finger]}
              </span>
            ))}
          </aside>
        </div>
      </header>

      <section className="pregame-readiness-strip" aria-label="Exercise setup path">
        <div className="pregame-readiness-steps">
          {setupSteps.map(({ label, Icon }, index) => (
            <div className="pregame-readiness-step" key={label}>
              <span className="pregame-readiness-step-icon" aria-hidden>
                <Icon size={17} strokeWidth={2.25} />
              </span>
              <strong>{label}</strong>
              {index < setupSteps.length - 1 ? <span className="pregame-step-connector" aria-hidden /> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="pregame-lower">
        <div className="pregame-quick-section">
          <h3>How to do it</h3>
          <ol className="pregame-instruction-list">
            <li>Relax your hand open before each rep.</li>
            <li>Bend only the highlighted finger or finger group.</li>
            <li>Release back to open before starting the next rep.</li>
          </ol>
        </div>
      </section>
    </section>
  );
}

function PatientExerciseSession({
  assignment,
  onBack,
  onComplete
}: {
  assignment: PatientExerciseAssignment;
  onBack: () => void;
  onComplete: (result: ExercisePlayResult) => void;
}) {
  const input = usePatientInput();
  const exercise = assignment.exercise;
  const startedAtRef = useRef(Date.now());
  const pressedRef = useRef(false);
  const [reps, setReps] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState("Open your hand, then bend the target fingers.");
  const targetSet = useMemo(() => new Set<FingerName>(exercise.fingers), [exercise.fingers]);
  const nonTargetFingers = useMemo(() => fingerNames.filter((finger) => !targetSet.has(finger)), [targetSet]);
  const targetAverage = Math.round(exercise.fingers.reduce((sum, finger) => sum + input.fingerBends[finger], 0) / exercise.fingers.length);
  const nonTargetAverage = nonTargetFingers.length
    ? Math.round(nonTargetFingers.reduce((sum, finger) => sum + input.fingerBends[finger], 0) / nonTargetFingers.length)
    : 0;
  const progress = Math.min(100, Math.round((reps / exercise.reps) * 100));

  useEffect(() => {
    if (reps >= exercise.reps) return;
    const targetPressed = exercise.fingers.every((finger) => input.fingerBends[finger] >= 55);
    const otherRelaxed = nonTargetFingers.every((finger) => input.fingerBends[finger] <= 52);
    const released = exercise.fingers.every((finger) => input.fingerBends[finger] <= 35);

    if (!pressedRef.current && targetPressed && otherRelaxed) {
      pressedRef.current = true;
      setAttempts((value) => value + 1);
      setFeedback("Good hold. Open your hand to finish the rep.");
      return;
    }

    if (pressedRef.current && released) {
      pressedRef.current = false;
      setReps((value) => {
        const next = Math.min(exercise.reps, value + 1);
        setFeedback(next >= exercise.reps ? "Exercise complete." : "Rep counted. Bend again when ready.");
        return next;
      });
    } else if (!pressedRef.current && targetPressed && !otherRelaxed) {
      setFeedback("Try to keep the non-target fingers relaxed.");
    }
  }, [exercise.fingers, exercise.reps, input.fingerBends, nonTargetFingers, reps]);

  useEffect(() => {
    if (reps < exercise.reps) return;
    const timeTakenSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    onComplete({
      repsCompleted: reps,
      targetReps: exercise.reps,
      accuracy: Math.max(60, Math.min(100, Math.round((reps / Math.max(1, attempts)) * 100))),
      timeTakenSeconds,
      completedAt: new Date().toISOString()
    });
  }, [attempts, exercise.reps, onComplete, reps]);

  const demoRep = () => {
    const bent = fingerNames.reduce<FingerBends>(
      (values, finger) => {
        values[finger] = targetSet.has(finger) ? 82 : 12;
        return values;
      },
      { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }
    );
    input.emitGesture(input.currentGesture, bent);
    window.setTimeout(() => input.emitGesture("open"), 260);
  };

  return (
    <section className="page-stack patient-exercise-play">
      <BackButton onBack={onBack} label="Exercise Detail" />
      <article className="surface patient-exercise-session">
        <div className="section-title">
          <div>
            <span className="eyebrow">Exercise in progress</span>
            <h2>{exercise.name}</h2>
          </div>
          <span className="status-pill status-active">{reps}/{exercise.reps} reps</span>
        </div>

        <div className="exercise-progress-track" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="exercise-live-grid">
          <div className="exercise-live-target">
            <strong>{feedback}</strong>
            <p>{exercise.fingers.map((finger) => fingerLabels[finger]).join(" + ")}</p>
            <div className="exercise-live-stat-row">
              <span>Target bend {targetAverage}%</span>
              <span>Other fingers {nonTargetAverage}%</span>
              <span>{input.rawConnected ? "Glove connected" : "Demo stream"}</span>
            </div>
          </div>
          <div className="exercise-finger-meter-list">
            {fingerNames.map((finger) => (
              <div className={targetSet.has(finger) ? "exercise-finger-meter is-target" : "exercise-finger-meter"} key={finger}>
                <span>{fingerLabels[finger]}</span>
                <div>
                  <i style={{ width: `${Math.max(0, Math.min(100, input.fingerBends[finger]))}%` }} />
                </div>
                <strong>{Math.round(input.fingerBends[finger])}%</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="exercise-session-actions">
          <button type="button" className="secondary-button" onClick={demoRep}>
            Demo Rep
          </button>
        </div>
      </article>
    </section>
  );
}

function PatientExerciseResults({
  assignment,
  result,
  onReplay,
  onDashboard
}: {
  assignment: PatientExerciseAssignment;
  result?: ExercisePlayResult;
  onReplay: () => void;
  onDashboard: () => void;
}) {
  const exercise = assignment.exercise;
  return (
    <section className="page-stack">
      <article className="surface results-page patient-exercise-results">
        <div className="section-title">
          <div>
            <span className="eyebrow">Exercise complete</span>
            <h2>{exercise.name}</h2>
          </div>
        </div>
        <div className="result-grid">
          <article className="metric-card tone-teal">
            <div className="metric-icon"><CheckCircle2 size={20} /></div>
            <span>Reps</span>
            <strong>{result?.repsCompleted ?? 0}/{result?.targetReps ?? exercise.reps}</strong>
            <small>Completed</small>
          </article>
          <article className="metric-card tone-blue">
            <div className="metric-icon"><Gauge size={20} /></div>
            <span>Accuracy</span>
            <strong>{result?.accuracy ?? 0}%</strong>
            <small>Target isolation</small>
          </article>
          <article className="metric-card tone-amber">
            <div className="metric-icon"><Timer size={20} /></div>
            <span>Time</span>
            <strong>{result?.timeTakenSeconds ?? 0}s</strong>
            <small>Practice duration</small>
          </article>
        </div>
        <div className="result-actions">
          <button type="button" className="secondary-button" onClick={onReplay}>Repeat Exercise</button>
          <button type="button" className="primary-button" onClick={onDashboard}>Back to Plan</button>
        </div>
      </article>
    </section>
  );
}

function AssignmentDetail({
  assignment,
  onBack,
  onCalibration,
  onQuickPlay
}: {
  assignment: PatientCareAssignment;
  onBack: () => void;
  onCalibration: () => void;
  onQuickPlay: () => void;
}) {
  const setupSteps = [
    { label: "Check in", Icon: Heart },
    { label: "Calibrate", Icon: HandMetal },
    { label: "Play", Icon: Play }
  ];
  const skills = assignment.config.targetSkills;
  const instructions = pregameInstructionSteps[assignment.gameId];

  return (
    <section className={`page-stack pregame-detail pregame-detail--theme-${assignment.gameId}`}>
      <BackButton onBack={onBack} label="Back" />

      <header className="pregame-hero" aria-labelledby="pregame-title">
        <div className="pregame-hero-grid">
          <div className="pregame-hero-copy">
            <h2 className="pregame-hero-title" id="pregame-title">{assignment.name}</h2>
            <p className="pregame-hero-sub">{rehabGameCatalogTagline(assignment.gameId)}</p>
            <div className="pregame-chip-row" aria-label="Session parameters">
              <span className="pregame-chip pregame-chip--reps">
                <Repeat size={14} strokeWidth={2.25} aria-hidden /> {assignment.config.targetReps} reps
              </span>
              <span className="pregame-chip pregame-chip--rounds">
                <Layers size={14} strokeWidth={2.25} aria-hidden /> {assignment.config.rounds} rounds
              </span>
              <span className="pregame-chip pregame-chip--schedule">
                <CalendarClock size={14} strokeWidth={2.25} aria-hidden /> {assignment.config.frequency}
              </span>
              <span className="pregame-chip pregame-chip--level">
                <Gauge size={14} strokeWidth={2.25} aria-hidden /> {difficultyLabel(assignment.config.difficulty)}
              </span>
            </div>
            <div className="pregame-hero-actions">
              <button type="button" className="primary-button pregame-hero-cta" onClick={onCalibration}>
                <Play size={18} />
                Start Rehab
              </button>
              <button type="button" className="secondary-button pregame-hero-cta" onClick={onQuickPlay}>
                Skip Setup and Play
              </button>
            </div>
          </div>
          <aside className="pregame-hero-visual" aria-hidden>
            <AnimatedGamePreview gameId={assignment.gameId} difficulty={assignment.config.difficulty} />
          </aside>
        </div>
      </header>

      <section className="pregame-readiness-strip" aria-label="Session setup path">
        <div className="pregame-readiness-steps">
          {setupSteps.map(({ label, Icon }, index) => (
            <div className="pregame-readiness-step" key={label}>
              <span className="pregame-readiness-step-icon" aria-hidden>
                <Icon size={17} strokeWidth={2.25} />
              </span>
              <strong>{label}</strong>
              {index < setupSteps.length - 1 ? <span className="pregame-step-connector" aria-hidden /> : null}
            </div>
          ))}
        </div>
      </section>

      <div className="pregame-lower">
        <section className="pregame-quick-section">
          <h3>Before you begin</h3>
          <ol className="pregame-instruction-list">
            {instructions.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="pregame-quick-section pregame-skills-section">
          <h3>Skills</h3>
          <div className="pregame-skill-pills">
            {skills.map((skill) => (
              <span key={skill} className="pregame-skill-pill">
                {skill}
              </span>
            ))}
          </div>
        </section>

        <details className="pregame-details">
          <summary>Doctor notes</summary>
          <div className="pregame-details-body">
            <p>{assignment.doctorInstructions}</p>
            {assignment.doctorNotes.trim() ? <p>{assignment.doctorNotes}</p> : null}
          </div>
        </details>
      </div>
    </section>
  );
}

function TutorialPage({
  assignment,
  onBack,
  onContinue
}: {
  assignment: PatientCareAssignment;
  onBack: () => void;
  onContinue: () => void;
}) {
  const tutorial = gameTutorials[assignment.gameId];
  return (
    <section className="page-stack">
      <BackButton onBack={onBack} label="Assignment Detail" />
      <article className="surface tutorial-page">
        <div className="section-title">
          <div>
            <span className="eyebrow">Tutorial</span>
            <h2>{tutorial.title}</h2>
          </div>
        </div>
        <TutorialSteps assignment={assignment} />
        <button type="button" className="primary-button" onClick={onContinue}>
          Continue
        </button>
      </article>
    </section>
  );
}

function TutorialSteps({ assignment, compact = false, pregame = false }: { assignment: PatientCareAssignment; compact?: boolean; pregame?: boolean }) {
  const tutorial = gameTutorials[assignment.gameId];
  if (pregame) {
    return (
      <div className="pregame-steps">
        {tutorial.steps.map((step, index) => (
          <div className="pregame-step-row" key={step}>
            <span className="pregame-step-num">{index + 1}</span>
            <p>{step}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={compact ? "tutorial-steps compact" : "tutorial-steps"}>
      {tutorial.steps.map((step, index) => (
        <div className="tutorial-step-card" key={step}>
          <strong>{index + 1}</strong>
          <p>{step}</p>
        </div>
      ))}
    </div>
  );
}

function CalibrationScreen({
  assignment,
  onBack,
  onComplete,
  onSkip
}: {
  assignment: PatientCareAssignment;
  onBack: () => void;
  onComplete: (calibration: CalibrationData) => void;
  onSkip: () => void;
}) {
  const input = usePatientInput();
  const [steps, setSteps] = useState<CalibrationData["steps"]>({});
  const [fingerTaps, setFingerTaps] = useState<CalibrationData["fingerTaps"]>({});
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationRunPhase>("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const [holdStartedAt, setHoldStartedAt] = useState<number | null>(null);
  const [holdProgressMs, setHoldProgressMs] = useState(0);
  const [qualityByTarget, setQualityByTarget] = useState<Record<string, FingerTapCaptureQuality>>({});
  const [activeQuality, setActiveQuality] = useState<FingerTapCaptureQuality | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<CalibrationTarget | null>(null);
  const activeSamplesRef = useRef<CalibrationSample[]>([]);
  const sampleKeysRef = useRef<Set<string>>(new Set());
  const isBallPickup = assignment.gameId === "ball-pickup";
  const isFingerTap = assignment.gameId === "finger-tap-piano";
  const isBubblePop = assignment.gameId === "bubble-pop";
  const calibrationTargets = useMemo<CalibrationTarget[]>(() => {
    const targetSteps = isBubblePop
      ? (["open", "fist", "point", "pinch"] as Array<keyof CalibrationData["steps"]>)
      : isBallPickup || isFingerTap || assignment.gameId === "carrom-flick"
      ? (["open", "fist"] as Array<keyof CalibrationData["steps"]>)
      : (["open", "fist"] as Array<keyof CalibrationData["steps"]>);
    return [
      ...targetSteps.map((step) => ({
        id: step,
        kind: "step" as const,
        step,
        label: calibrationGestureMeta(step)?.label ?? step
      })),
      ...(isFingerTap
        ? fingerNames.map((finger) => ({
            id: `tap-${finger}`,
            kind: "finger" as const,
            finger,
            label: `${fingerLabels[finger]} tap`
          }))
        : [])
    ];
  }, [assignment.gameId, isBallPickup, isBubblePop, isFingerTap]);
  const requiredSteps = calibrationTargets.length;
  const hasFreshRaw = input.rawConnected && Date.now() - input.lastRawAt <= 1800 && input.rawSamples.length > 0;
  const ready = calibrationTargets.every((target) =>
    target.kind === "step" ? Boolean(steps[target.step]) : Boolean(fingerTaps[target.finger])
  );

  const activeTarget = calibrationTargets[activeIndex] ?? null;
  const calibrationRunning = calibrationPhase !== "idle" && calibrationPhase !== "complete";
  const modalTarget = calibrationPhase === "captured" && feedbackTarget ? feedbackTarget : activeTarget;
  const activeInstruction = activeTarget
    ? activeTarget.kind === "step"
      ? activeTarget.step === "open"
        ? "Hold your hand open and relaxed."
        : activeTarget.step === "fist"
          ? "Close into a comfortable fist and hold."
          : activeTarget.step === "point"
            ? "Point with your index finger and hold."
            : "Pinch thumb and index lightly and hold."
      : `Tap and hold ${activeTarget.label.replace(" tap", "")}.`
    : ready
      ? "Calibration complete."
      : "Start calibration when the glove is ready.";

  const captureTarget = (target: CalibrationTarget, values: FingerBends) => {
    if (target.kind === "step") {
      setSteps((items) => ({ ...items, [target.step]: values }));
      return;
    }
    setFingerTaps((items) => ({ ...items, [target.finger]: values }));
  };

  const resetActiveHold = () => {
    setHoldStartedAt(null);
    setHoldProgressMs(0);
    activeSamplesRef.current = [];
    sampleKeysRef.current = new Set();
  };

  useEffect(() => {
    if (calibrationPhase !== "hold" || !activeTarget) return undefined;
    if (!hasFreshRaw) {
      resetActiveHold();
      return undefined;
    }

    if (holdStartedAt === null) {
      const now = Date.now();
      setHoldStartedAt(now);
      setHoldProgressMs(0);
      activeSamplesRef.current = [];
      sampleKeysRef.current = new Set();
    }

    const tick = window.setInterval(() => {
      const startedAt = holdStartedAt ?? Date.now();
      const now = Date.now();
      const elapsed = Math.min(now - startedAt, CALIBRATION_HOLD_MS);
      setHoldProgressMs(elapsed);
      if (input.rawValues && now - startedAt >= CALIBRATION_SAMPLE_WARMUP_MS) {
        const key = `${input.lastRawAt}:${rawSampleKey(input.rawValues)}`;
        if (!sampleKeysRef.current.has(key)) {
          sampleKeysRef.current.add(key);
          activeSamplesRef.current = [{ key, at: now, values: input.rawValues }, ...activeSamplesRef.current].slice(0, 36);
        }
      }

      if (elapsed >= CALIBRATION_HOLD_MS) {
        const freshSamples = activeSamplesRef.current.map((sample) => sample.values);
        const averaged = averageRawSamples(freshSamples);
        const quality =
          activeTarget.kind === "finger"
            ? assessFingerTapCaptureQuality({
                finger: activeTarget.finger,
                samples: freshSamples,
                averaged,
                open: steps.open,
                closed: steps.fist,
                existingFingerTaps: fingerTaps
              })
            : basicCaptureQuality(freshSamples, averaged);
        setActiveQuality(quality);

        if (!averaged || !quality.ok) {
          setQualityByTarget((items) => ({ ...items, [activeTarget.id]: quality }));
          setFeedbackTarget(activeTarget);
          resetActiveHold();
          setCalibrationPhase("retry");
          return;
        }

        captureTarget(activeTarget, averaged);
        setQualityByTarget((items) => ({ ...items, [activeTarget.id]: quality }));
        const nextIndex = activeIndex + 1;
        setFeedbackTarget(activeTarget);
        setActiveIndex(nextIndex);
        resetActiveHold();
        if (nextIndex >= calibrationTargets.length) {
          setCalibrationPhase("complete");
        } else {
          setCalibrationPhase("captured");
        }
      }
    }, 80);

    return () => window.clearInterval(tick);
  }, [activeIndex, activeTarget, calibrationPhase, calibrationTargets.length, fingerTaps, hasFreshRaw, holdStartedAt, input.lastRawAt, input.rawValues, steps.fist, steps.open]);

  const startCalibration = () => {
    setSteps({});
    setFingerTaps({});
    setQualityByTarget({});
    setActiveQuality(null);
    setFeedbackTarget(null);
    setActiveIndex(0);
    setHoldStartedAt(null);
    setHoldProgressMs(0);
    activeSamplesRef.current = [];
    sampleKeysRef.current = new Set();
    setCalibrationPhase("prepare");
  };

  const beginCurrentHold = () => {
    if (!activeTarget || !hasFreshRaw) return;
    setActiveQuality(null);
    setFeedbackTarget(null);
    resetActiveHold();
    setCalibrationPhase("hold");
  };

  const prepareNextTarget = () => {
    setActiveQuality(null);
    setFeedbackTarget(null);
    resetActiveHold();
    setCalibrationPhase("prepare");
  };

  const finish = () => {
    const fingerTapProfiles = buildFingerTapProfiles(steps.open, steps.fist, fingerTaps);
    const calibration: CalibrationData = {
      id: `calibration-${Date.now()}`,
      patientId: assignment.patientId,
      assignmentId: assignment.id,
      inputMode: input.inputMode,
      completedAt: new Date().toISOString(),
      steps,
      fingerTaps,
      fingerTapProfiles,
      thresholds: {
        openAverage: averageBend(steps.open),
        fistAverage: averageBend(steps.fist),
        pinchIndexGap: steps.pinch ? Math.abs(steps.pinch.thumb - steps.pinch.index) : 0
      }
    };
    if (steps.open && steps.fist) {
      saveCalibration(assignment.patientId, { open: steps.open, closed: steps.fist }).catch(() => {});
    }
    onComplete(calibration);
  };

  const capturedCount = calibrationTargets.reduce(
    (sum, target) => sum + (target.kind === "step" ? Number(Boolean(steps[target.step])) : Number(Boolean(fingerTaps[target.finger]))),
    0
  );
  const progressPct = Math.round((capturedCount / requiredSteps) * 100);
  const holdPct = Math.round((holdProgressMs / CALIBRATION_HOLD_MS) * 100);
  const remainingHoldSeconds = Math.ceil(Math.max(CALIBRATION_HOLD_MS - holdProgressMs, 0) / 1000);
  const modalTitle =
    calibrationPhase === "complete"
      ? "Calibration Complete"
      : calibrationPhase === "captured"
        ? "Captured"
        : calibrationPhase === "retry"
          ? "Try Again"
          : modalTarget?.label ?? "Calibration";
  const modalCopy =
    calibrationPhase === "complete"
      ? "All required glove positions are captured. You can continue when ready."
      : calibrationPhase === "captured"
        ? `${feedbackTarget?.label ?? "Step"} captured. Relax your hand before the next prompt.`
        : calibrationPhase === "retry"
          ? activeQuality?.message ?? "The glove did not get a stable capture. Relax, then try the same prompt again."
          : calibrationPhase === "hold"
            ? activeInstruction
            : modalTarget
              ? `Next: ${activeInstruction}`
              : "Start calibration when the glove is ready.";

  return (
    <section className="page-stack patient-flow-page patient-calibration-page">
      <div className="patient-flow-shell">
        <BackButton onBack={onBack} label="Assignment Detail" />

        <header className="surface cal-hero-card">
          <div className="cal-hero-left">
            <div className="cal-hero-kicker">
              <span className="eyebrow">Calibration · Smart glove</span>
              <span className="cal-hero-steps-pill">
                <Activity size={14} aria-hidden strokeWidth={2.25} /> {capturedCount}/{requiredSteps} captured
              </span>
            </div>
            <h2 className="cal-hero-title">Set Up the Smart Glove</h2>
            <p className="cal-hero-copy">
              Start calibration, then hold each prompted shape for 3 seconds. The live hand view stays active while the glove records your raw range.
            </p>
            <div className="cal-progress-shell" aria-label="Calibration completion">
              <div className="cal-progress-bar-wrap">
                <div
                  className="cal-progress-bar"
                  role="progressbar"
                  aria-valuenow={capturedCount}
                  aria-valuemin={0}
                  aria-valuemax={requiredSteps}
                  aria-valuetext={`${capturedCount} of ${requiredSteps} steps`}
                >
                  <div className="cal-progress-bar-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <span className="cal-progress-chip">
                Calibration steps · {progressPct}% complete
              </span>
            </div>
          </div>
          <div className="cal-hero-visual">
            <Canvas
              style={{ height: 220, width: "100%", borderRadius: 12, background: "#1e293b" }}
              camera={{ position: [0, 0.15, 1.4], fov: 50 }}
            >
              <ambientLight intensity={0.9} />
              <directionalLight position={[3, 5, 2]} intensity={1.4} />
              <HandModel3D bends={input.fingerBends} />
            </Canvas>
            <p style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted, #64748b)", marginTop: "0.35rem" }}>
              Live glove preview — follow the active prompt
            </p>
          </div>
        </header>

        <section className="surface cal-live-panel" aria-labelledby="cal-live-heading">
          <div className="cal-finger-panel__intro">
            <div>
              <h3 id="cal-live-heading">{activeTarget ? activeTarget.label : "Ready to calibrate"}</h3>
              <p>{activeInstruction}</p>
            </div>
            <span className={`cal-status ${hasFreshRaw ? "cal-status--ok" : "cal-status--muted"}`}>
              {hasFreshRaw ? "Live glove" : "Waiting for glove"}
            </span>
          </div>
          <div className="cal-progress-shell" aria-label="Current calibration hold">
            <div className="cal-progress-bar-wrap">
              <div className="cal-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={CALIBRATION_HOLD_MS} aria-valuenow={holdProgressMs}>
                <div className="cal-progress-bar-fill" style={{ width: `${holdPct}%` }} />
              </div>
            </div>
            <span className="cal-progress-chip">
              {calibrationPhase === "hold" ? `${remainingHoldSeconds}s hold` : ready ? "Complete" : calibrationPhase === "captured" ? "Rest before next" : "Not holding"}
            </span>
          </div>
          {activeQuality ? (
            <p className={`safe-note ${activeQuality.ok ? "cal-quality-note--ok" : "cal-quality-note--warn"}`}>
              {activeQuality.message} Samples {activeQuality.sampleCount} · signal {Math.round(activeQuality.signal)} · stability {Math.round(activeQuality.stability)}
            </p>
          ) : null}

          <div className="cal-finger-strip" role="list">
            {calibrationTargets.map((target, index) => {
              const captured = target.kind === "step" ? Boolean(steps[target.step]) : Boolean(fingerTaps[target.finger]);
              const active = calibrationPhase !== "idle" && index === activeIndex;
              const quality = qualityByTarget[target.id];
              return (
                <div key={target.id} role="listitem" className={["cal-finger-pill", captured ? "is-captured" : "", active ? "is-next" : "", captured ? "" : "is-pending"].filter(Boolean).join(" ")}>
                  <span className="cal-finger-pill__ix" aria-hidden>{index + 1}</span>
                  <span className="cal-finger-pill__name">{target.label}</span>
                  <span className="cal-finger-pill__state">{captured ? "Captured" : active ? "Hold" : quality && !quality.ok ? "Retry" : "Queued"}</span>
                  {captured ? <CheckCircle2 className="cal-finger-pill__check" size={14} aria-hidden strokeWidth={2.5} /> : null}
                </div>
              );
            })}
          </div>

          <button type="button" className="primary-button patient-flow-cta patient-flow-primary" disabled={calibrationRunning || !hasFreshRaw} onClick={startCalibration}>
            {ready ? "Restart Calibration" : "Start Calibration"}
          </button>
        </section>

        {calibrationPhase !== "idle" ? (
          <div className="calibration-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-modal-title">
            <div className={`calibration-modal-card calibration-modal-card--${calibrationPhase}`}>
              <div className="calibration-modal-orbit" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <div className="calibration-modal-head">
                <span className={`calibration-modal-state calibration-modal-state--${calibrationPhase}`}>
                  {calibrationPhase === "hold"
                    ? `${remainingHoldSeconds}s`
                    : calibrationPhase === "captured"
                      ? "Rest"
                      : calibrationPhase === "retry"
                        ? "Retry"
                        : calibrationPhase === "complete"
                          ? "Done"
                          : "Ready"}
                </span>
                <div>
                  <p className="calibration-modal-eyebrow">
                    Step {Math.min(activeIndex + 1, requiredSteps)} of {requiredSteps}
                  </p>
                  <h3 id="calibration-modal-title">{modalTitle}</h3>
                </div>
              </div>
              <p className="calibration-modal-copy">{modalCopy}</p>

              <div className="calibration-modal-preview">
                <Canvas
                  style={{ height: 190, width: "100%", borderRadius: 16, background: "#1e293b" }}
                  camera={{ position: [0, 0.15, 1.4], fov: 50 }}
                >
                  <ambientLight intensity={0.9} />
                  <directionalLight position={[3, 5, 2]} intensity={1.4} />
                  <HandModel3D bends={input.fingerBends} />
                </Canvas>
              </div>

              {calibrationPhase === "hold" ? (
                <div className="calibration-modal-hold">
                  <div className="calibration-modal-ring" style={{ ["--cal-hold" as string]: `${holdPct}%` }}>
                    <span>{holdPct}%</span>
                  </div>
                  <div className="cal-progress-shell" aria-label="Modal calibration hold">
                    <div className="cal-progress-bar-wrap">
                      <div className="cal-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={CALIBRATION_HOLD_MS} aria-valuenow={holdProgressMs}>
                        <div className="cal-progress-bar-fill" style={{ width: `${holdPct}%` }} />
                      </div>
                    </div>
                    <span className="cal-progress-chip">Keep holding until the ring fills.</span>
                  </div>
                </div>
              ) : null}

              {activeQuality && (calibrationPhase === "retry" || calibrationPhase === "captured") ? (
                <p className={`calibration-modal-quality ${activeQuality.ok ? "is-ok" : "is-warn"}`}>
                  Samples {activeQuality.sampleCount} · signal {Math.round(activeQuality.signal)} · stability {Math.round(activeQuality.stability)}
                </p>
              ) : null}

              <div className="calibration-modal-actions">
                {calibrationPhase === "prepare" ? (
                  <button type="button" className="primary-button patient-flow-primary" disabled={!hasFreshRaw} onClick={beginCurrentHold}>
                    Begin 3s Hold
                  </button>
                ) : null}
                {calibrationPhase === "captured" ? (
                  <button type="button" className="primary-button patient-flow-primary" onClick={prepareNextTarget}>
                    Next Prompt
                  </button>
                ) : null}
                {calibrationPhase === "retry" ? (
                  <button type="button" className="primary-button patient-flow-primary" disabled={!hasFreshRaw} onClick={beginCurrentHold}>
                    Retry Hold
                  </button>
                ) : null}
                {calibrationPhase === "complete" ? (
                  <button type="button" className="primary-button patient-flow-primary" onClick={() => setCalibrationPhase("idle")}>
                    Review and Continue
                  </button>
                ) : null}
                {calibrationPhase !== "hold" && calibrationPhase !== "complete" ? (
                  <button type="button" className="secondary-button" onClick={() => setCalibrationPhase("idle")}>
                    Pause Calibration
                  </button>
                ) : null}
              </div>

              {!hasFreshRaw && calibrationPhase !== "complete" ? (
                <p className="calibration-modal-footnote">Waiting for fresh raw glove frames from the ESP32 bridge.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!ready && (
          <p className="cal-footer-hint safe-note">
            {hasFreshRaw ? "Press Start Calibration and follow each 3-second prompt." : "Waiting for fresh raw glove frames from the ESP32 bridge."}
          </p>
        )}

        <button type="button" className="primary-button patient-flow-cta patient-flow-primary" disabled={!ready} onClick={finish}>
          Continue
        </button>
        <button type="button" className="secondary-button patient-flow-cta" onClick={onSkip}>
          Skip Calibration and Play
        </button>
      </div>
    </section>
  );
}

function PainFatigueCheckIn({
  title,
  phase,
  before,
  backLabel = "Back",
  onBack,
  onSubmit
}: {
  title: string;
  phase: CheckIn["phase"];
  before?: CheckIn;
  backLabel?: string;
  onBack: () => void;
  onSubmit: (checkIn: CheckIn) => void;
}) {
  const [pain, setPain] = useState(before?.pain ?? 0);
  const [fatigue, setFatigue] = useState(before?.fatigue ?? 0);
  const current: CheckIn = { phase, pain, fatigue, recordedAt: new Date().toISOString() };
  const warning = before ? checkInIncreaseWarning(before, current) : "";

  const lede =
    phase === "pre"
      ? "Pause for twenty seconds — honest snapshots keep every session aligned with how you truly feel."
      : "Brief reflection after movement helps your care team see how play impacts comfort and stamina.";

  const painHelper =
    phase === "pre" ? "How much discomfort do you feel right now?" : "How much discomfort are you noticing after this session?";
  const fatigueHelper =
    phase === "pre" ? "How tired does your hand feel right now?" : "How fatigued does your hand feel after this round?";

  return (
    <section className="page-stack patient-flow-page patient-checkin-page">
      <div className="patient-flow-shell patient-flow-shell--compact">
        <BackButton onBack={onBack} label={backLabel} />
        <article className="surface checkin-sheet">
          <header className="checkin-header">
            <div className="checkin-header-copy">
              <span className="checkin-hero-eyebrow">Pain and Fatigue Check-In</span>
              <h2 className="checkin-title">{title}</h2>
              <p className="checkin-lede">{lede}</p>
            </div>
            <div className="checkin-header-art" aria-hidden>
              <CheckInWellnessArt phase={phase} />
              <Sparkles size={22} strokeWidth={1.8} className="checkin-sparkle" aria-hidden />
            </div>
          </header>

          <div className="checkin-fields">
            <div className="checkin-slider-block">
              <div className="checkin-slider-meta">
                <div>
                  <span className="checkin-slider-title">Pain</span>
                  <p className="checkin-helper">{painHelper}</p>
                </div>
                <span className="checkin-value-pill" aria-live="polite">
                  {pain}/10
                </span>
              </div>
              <div className="checkin-range checkin-range--pain">
                <div className="checkin-range__track-bg" aria-hidden />
                <div
                  className="checkin-range__track-fill checkin-range__track-fill--pain"
                  style={{ width: `${pain * 10}%` }}
                  aria-hidden
                />
                <input
                  type="range"
                  className="checkin-range__input"
                  min={0}
                  max={10}
                  value={pain}
                  onChange={(event) => setPain(Number(event.target.value))}
                  aria-valuetext={`${pain} out of 10`}
                />
              </div>
              <div className="checkin-scale-labels" aria-hidden>
                <span>0 · None</span>
                <span>5 · Moderate</span>
                <span>10 · High</span>
              </div>
            </div>

            <div className="checkin-slider-block">
              <div className="checkin-slider-meta">
                <div>
                  <span className="checkin-slider-title">Fatigue</span>
                  <p className="checkin-helper">{fatigueHelper}</p>
                </div>
                <span className="checkin-value-pill" aria-live="polite">
                  {fatigue}/10
                </span>
              </div>
              <div className="checkin-range checkin-range--fatigue">
                <div className="checkin-range__track-bg" aria-hidden />
                <div
                  className="checkin-range__track-fill checkin-range__track-fill--fatigue"
                  style={{ width: `${fatigue * 10}%` }}
                  aria-hidden
                />
                <input
                  type="range"
                  className="checkin-range__input"
                  min={0}
                  max={10}
                  value={fatigue}
                  onChange={(event) => setFatigue(Number(event.target.value))}
                  aria-valuetext={`${fatigue} out of 10`}
                />
              </div>
              <div className="checkin-scale-labels" aria-hidden>
                <span>0 · None</span>
                <span>5 · Moderate</span>
                <span>10 · High</span>
              </div>
            </div>
          </div>

          {warning && (
            <div className="warning-callout checkin-warning">
              <AlertTriangle size={18} />
              <span>{warning}</span>
            </div>
          )}
          <button type="button" className="primary-button patient-flow-cta patient-flow-primary" onClick={() => onSubmit(current)}>
            {phase === "pre" ? "Continue" : "View Results"}
          </button>
        </article>
      </div>
    </section>
  );
}

function ResultsPage({
  assignment,
  preCheck,
  postCheck,
  calibration,
  gameResult,
  saveState,
  saveMessage,
  onSave,
  onDashboard
}: {
  assignment: PatientCareAssignment;
  preCheck?: CheckIn;
  postCheck?: CheckIn;
  calibration?: CalibrationData;
  gameResult?: GamePlayResult;
  saveState: "idle" | "saving" | "saved" | "error";
  saveMessage: string;
  onSave: () => void;
  onDashboard: () => void;
}) {
  if (!gameResult || !preCheck || !postCheck) {
    return (
      <section className="page-stack">
        <EmptyState title="Results Are Not Ready" detail="Complete the game and post-session check-in first." />
      </section>
    );
  }

  const weakestFinger = gameResult.weakestFinger ?? (gameResult.events.length ? weakestFingerFromEvents(gameResult.events) : undefined);
  const encouragement = encouragementFor({ ...gameResult, weakestFinger });
  const warning = checkInIncreaseWarning(preCheck, postCheck);

  return (
    <section className="page-stack">
      <article className="surface results-panel">
        <div className="section-title">
          <div>
            <span className="eyebrow">Session Results</span>
            <h2>{assignment.name}</h2>
          </div>
          <span className="status-pill status-active">{gameResult.accuracy}% Accuracy</span>
        </div>
        <div className="patient-metric-grid">
          <article className="metric-card tone-teal"><span>Reps Completed</span><strong>{gameResult.repsCompleted}</strong><small>{gameResult.successfulReps} Successful Reps</small></article>
          <article className="metric-card tone-red"><span>Failed Attempts</span><strong>{gameResult.failedAttempts}</strong><small>Missed or incorrect actions</small></article>
          <article className="metric-card tone-blue"><span>Time Taken</span><strong>{gameResult.timeTakenSeconds}s</strong><small>{calibration ? inputModeLabels[calibration.inputMode] : "Smart Glove"}</small></article>
          {gameResult.bestStreak !== undefined && (
            <article className="metric-card tone-violet"><span>Best Streak</span><strong>{gameResult.bestStreak}</strong><small>Consecutive successes if recorded</small></article>
          )}
          <article className="metric-card tone-amber"><span>Weakest Finger</span><strong>{weakestFinger ? fingerLabels[weakestFinger] : "N/A"}</strong><small>If available from input data</small></article>
        </div>
        <div className="result-checkin-grid">
          <div>
            <strong>Pain</strong>
            <span>{preCheck.pain}/10 before to {postCheck.pain}/10 after</span>
          </div>
          <div>
            <strong>Fatigue</strong>
            <span>{preCheck.fatigue}/10 before to {postCheck.fatigue}/10 after</span>
          </div>
        </div>
        {warning && <div className="warning-callout"><AlertTriangle size={18} /><span>{warning}</span></div>}
        <p className="encouragement">{encouragement}</p>
        <div className="assignment-actions">
          <button type="button" className="primary-button" onClick={onSave} disabled={saveState === "saving" || saveState === "saved"}>
            <Save size={18} />
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save Result"}
          </button>
          <button type="button" className="secondary-button" onClick={onDashboard}>
            Back to Dashboard
          </button>
        </div>
        {saveMessage && <p className={saveState === "error" ? "error-text" : "safe-note"}>{saveMessage}</p>}
      </article>
    </section>
  );
}

function ProgressBar({ label, percent }: { label: string; percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="bar-track" aria-label={`${label} ${value}%`}>
        <div className="bar-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function PatientRecoveryProgress({
  patient,
  assignments,
  results
}: {
  patient: Patient;
  assignments: PatientCareAssignment[];
  results: SessionResult[];
}) {
  const sessions = recentPatientSessions(patient, results);
  const chronologicalSessions = sessions.slice().reverse();
  const resultTrend = results.slice().reverse();
  const totalReps = sessions.reduce((sum, session) => sum + session.repsCompleted, 0);
  const averageAccuracy = sessions.length
    ? Math.round(sessions.reduce((sum, session) => sum + (session.accuracy ?? session.averageAccuracy ?? 0), 0) / sessions.length)
    : 0;
  const bestAccuracy = sessions.length
    ? Math.max(...sessions.map((session) => session.accuracy ?? session.averageAccuracy ?? 0))
    : 0;
  const latestAccuracy = sessions[0]?.accuracy ?? sessions[0]?.averageAccuracy ?? 0;
  const firstAccuracy = chronologicalSessions[0]?.accuracy ?? chronologicalSessions[0]?.averageAccuracy ?? latestAccuracy;
  const accuracyDelta = Math.round(latestAccuracy - firstAccuracy);
  const latestPain = results[0]?.painAfter.pain;
  const firstPain = resultTrend[0]?.painBefore.pain ?? latestPain;
  const painDelta = latestPain !== undefined && firstPain !== undefined ? latestPain - firstPain : 0;

  const sessionChart = chronologicalSessions.slice(-8).map((session, index) => ({
    label: formatDate(session.startedAt),
    session: index + 1,
    reps: session.repsCompleted,
    accuracy: session.accuracy ?? session.averageAccuracy ?? 0
  }));

  const symptomChart = resultTrend.slice(-8).map((result) => ({
    label: formatDate(result.startedAt),
    pain: result.painAfter.pain,
    fatigue: result.painAfter.fatigue
  }));

  const assignmentProgress = assignments.map((assignment) => {
    const matchingResults = results.filter((result) => result.assignmentId === assignment.id);
    const reps = matchingResults.reduce((sum, result) => sum + result.repsCompleted, 0);
    const target = assignment.config.targetReps * Math.max(assignment.config.rounds, 1);
    const latest = matchingResults[0];
    return {
      assignment,
      reps,
      target,
      percent: Math.min(100, Math.round((reps / Math.max(target, 1)) * 100)),
      latest
    };
  });

  const weakestFingerCounts = results.reduce<Record<string, number>>((counts, result) => {
    if (!result.weakestFinger) return counts;
    counts[result.weakestFinger] = (counts[result.weakestFinger] ?? 0) + 1;
    return counts;
  }, {});
  const focusFinger = Object.entries(weakestFingerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as FingerName | undefined;

  return (
    <section className="page-stack patient-progress-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Recovery Progress</span>
          <h2>Your rehab improvements</h2>
          <p>Track your reps, movement accuracy, symptoms, and game-by-game progress over time.</p>
        </div>
        <span className="status-pill status-active">{sessions.length} sessions saved</span>
      </div>

      <div className="patient-metric-grid">
        <article className="metric-card tone-teal">
          <span>Total Reps</span>
          <strong>{totalReps}</strong>
          <small>All saved rehab sessions</small>
        </article>
        <article className="metric-card tone-blue">
          <span>Average Accuracy</span>
          <strong>{averageAccuracy}%</strong>
          <small>{accuracyDelta >= 0 ? `+${accuracyDelta}` : accuracyDelta} pts from first session</small>
        </article>
        <article className="metric-card tone-violet">
          <span>Best Accuracy</span>
          <strong>{bestAccuracy}%</strong>
          <small>Highest recorded game score</small>
        </article>
        <article className="metric-card tone-amber">
          <span>Current Focus</span>
          <strong>{focusFinger ? fingerLabels[focusFinger] : "Steady reps"}</strong>
          <small>{painDelta > 0 ? "Watch pain after play" : "Keep smooth control"}</small>
        </article>
      </div>

      <div className="two-column patient-progress-grid">
        <article className="surface progress-chart-card">
          <div className="section-title">
            <h3>Accuracy trend</h3>
            <span>Last {sessionChart.length} sessions</span>
          </div>
          {sessionChart.length === 0 ? (
            <EmptyState title="No session data yet" detail="Complete and save a game to start building your trend." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={sessionChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="accuracy" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} name="Accuracy %" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>

        <article className="surface progress-chart-card">
          <div className="section-title">
            <h3>Reps completed</h3>
            <span>Practice volume</span>
          </div>
          {sessionChart.length === 0 ? (
            <EmptyState title="No reps recorded yet" detail="Your completed reps will appear here after saved sessions." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sessionChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="reps" fill="#0f766e" radius={[6, 6, 0, 0]} name="Reps" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </article>
      </div>

      <div className="two-column patient-progress-grid">
        <article className="surface progress-chart-card">
          <div className="section-title">
            <h3>Pain and fatigue</h3>
            <span>After each game</span>
          </div>
          {symptomChart.length === 0 ? (
            <EmptyState title="No check-ins yet" detail="Pain and fatigue trends appear after game check-ins." />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={symptomChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis domain={[0, 10]} />
                <Tooltip />
                <Line type="monotone" dataKey="pain" stroke="#dc2626" strokeWidth={3} name="Pain" />
                <Line type="monotone" dataKey="fatigue" stroke="#f59e0b" strokeWidth={3} name="Fatigue" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>

        <article className="surface">
          <div className="section-title">
            <h3>Game progress</h3>
            <span>{assignments.length} assigned</span>
          </div>
          <div className="stack-list">
            {assignmentProgress.map(({ assignment, reps, target, percent, latest }) => (
              <div className="progress-game-row" key={assignment.id}>
                <div>
                  <strong>{assignment.name}</strong>
                  <p>{reps}/{target} reps completed{latest ? ` · ${latest.accuracy}% latest accuracy` : ""}</p>
                </div>
                <ProgressBar label={`${assignment.name} progress`} percent={percent} />
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="surface">
        <div className="section-title">
          <h3>Recent sessions</h3>
          <span>Your latest saved work</span>
        </div>
        <div className="stack-list">
          {sessions.slice(0, 5).map((session) => (
            <div className="calendar-row" key={session.id}>
              <div>
                <strong>{formatDateTime(session.startedAt)}</strong>
                <span>{session.gameName || session.exerciseName}</span>
              </div>
              <div>
                <h3>{session.repsCompleted} reps</h3>
                <p>{session.accuracy ?? session.averageAccuracy}% accuracy{session.weakestFinger ? ` · Focus: ${fingerLabels[session.weakestFinger]}` : ""}</p>
              </div>
              <span className="status-pill status-active">Saved</span>
            </div>
          ))}
          {sessions.length === 0 ? <EmptyState title="No sessions saved yet" detail="Finish a rehab game and save the result to see progress here." /> : null}
        </div>
      </article>
    </section>
  );
}

function PatientCalendar({
  patient,
  assignments,
  appointments,
  results,
  experienceMode = "patient"
}: {
  patient: Patient;
  assignments: PatientCareAssignment[];
  appointments: PatientCareAppointment[];
  results: SessionResult[];
  experienceMode?: "patient" | "doctor-library";
}) {
  const completedAssignmentIds = new Set(results.map((result) => result.assignmentId));
  const calendarItems = [
    ...appointments.map((appointment) => ({
      id: appointment.id,
      type: appointment.status === "upcoming" ? "Appointment" : "Past Appointment",
      title: appointment.title,
      date: appointment.startsAt,
      detail: `${appointment.clinician} · ${appointment.location}`,
      status: appointment.status
    })),
    ...assignments.map((assignment) => ({
      id: `${assignment.id}-due`,
      type: "Exercise Due",
      title: assignment.name,
      date: assignment.dueDate,
      detail: `${assignment.config.targetReps} Reps · ${assignment.config.frequency}`,
      status: completedAssignmentIds.has(assignment.id)
        ? "completed"
        : new Date(assignment.dueDate).getTime() < Date.now()
          ? "missed"
          : "upcoming"
    })),
    ...results.map((result) => ({
      id: result.id,
      type: "Completed Session",
      title: result.gameName,
      date: result.startedAt,
      detail: `${result.repsCompleted} Reps · ${result.accuracy}% Accuracy`,
      status: "completed"
    }))
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {experienceMode === "doctor-library" ? "Practice calendar · library previews" : "Patient Calendar"}
          </span>
          <h2>{experienceMode === "doctor-library" ? `${patient.name} · demos & due-date samples` : patient.name}</h2>
        </div>
      </div>
      <article className="surface calendar-list">
        {calendarItems.length === 0 ? (
          <EmptyState title="Calendar is empty" detail="Appointments and exercise dates will appear here." />
        ) : (
          calendarItems.map((item) => (
            <div className="calendar-row" key={item.id}>
              <div>
                <strong>{formatDateTime(item.date)}</strong>
                <span>{item.type}</span>
              </div>
              <div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <span className={`status-pill status-${item.status === "missed" ? "paused" : item.status === "completed" ? "active" : "review"}`}>
                {titleLabel(item.status)}
              </span>
            </div>
          ))
        )}
      </article>
    </section>
  );
}

function PatientAssistant({
  patient,
  assignments,
  results,
  experienceMode = "patient"
}: {
  patient: Patient;
  assignments: PatientCareAssignment[];
  results: SessionResult[];
  experienceMode?: "patient" | "doctor-library";
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      text:
        experienceMode === "doctor-library"
          ? "You're in the clinician Rehab Games library. I can summarize every game in the catalog and how previews work — I cannot diagnose patients or alter plans."
          : "I can explain assigned games, scores, clinician notes, and remaining reps. I cannot diagnose symptoms or change your care plan."
    }
  ]);
  const [draft, setDraft] = useState("");

  const respond = (question: string) => {
    const lower = question.toLowerCase();
    const medicalKeywords = ["diagnose", "diagnosis", "treatment", "medicine", "medication", "swelling", "numb", "emergency", "pain", "injury", "worse"];
    if (medicalKeywords.some((keyword) => lower.includes(keyword))) {
      return "I cannot diagnose symptoms or give treatment advice. Stop the exercise if needed, contact your clinician for medical concerns, and seek urgent care for severe or sudden symptoms.";
    }
    if (lower.includes("assigned") || lower.includes("exercise") || lower.includes("game")) {
      return `Today you have ${assignments.map((assignment) => assignment.name).join(", ")}. Start with Ball Pickup for a short first session.`;
    }
    if (lower.includes("how") || lower.includes("play")) {
      const game = assignments.find((assignment) => lower.includes(assignment.name.toLowerCase().split(" ")[0]));
      const tutorial = game ? gameTutorials[game.gameId] : gameTutorials["ball-pickup"];
      return `${tutorial.title}: ${tutorial.steps.join(" ")}`;
    }
    if (lower.includes("score") || lower.includes("accuracy")) {
      return "Accuracy estimates how closely your gestures matched the target movement. Failed attempts are missed drops, wrong taps, wrong bubbles, or missed flicks.";
    }
    if (lower.includes("rep") || lower.includes("left")) {
      const completedToday = new Set(results.filter((result) => new Date(result.startedAt).toDateString() === new Date().toDateString()).map((result) => result.assignmentId));
      const repsLeft = assignments
        .filter((assignment) => !completedToday.has(assignment.id))
        .reduce((sum, assignment) => sum + assignment.config.targetReps, 0);
      return `You have about ${repsLeft} assigned reps left today. Move slowly and rest between games.`;
    }
    if (lower.includes("note") || lower.includes("doctor")) {
      return assignments.map((assignment) => `${assignment.name}: ${assignment.doctorNotes}`).join(" ");
    }
    if (lower.includes("motivat") || lower.includes("encourage")) {
      return "A short, careful session still counts. Focus on smooth control and stop if your hand needs rest.";
    }
    return `For ${experienceMode === "doctor-library" ? `${patient.name} (library workspace)` : patient.name}, I can help with assigned exercises, how to play each game, what scores mean, reps left, doctor notes, and motivation.`;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    setMessages((items) => [
      ...items,
      { id: `patient-${Date.now()}`, role: "patient", text: question },
      { id: `assistant-${Date.now()}`, role: "assistant", text: respond(question) }
    ]);
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Patient Assistant</span>
          <h2>Ask About Your Rehab Plan</h2>
        </div>
      </div>
      <article className="surface assistant-panel">
        <div className="assistant-messages">
          {messages.map((message) => (
            <div className={`assistant-message ${message.role}`} key={message.id}>
              <span>{message.role === "assistant" ? "Assistant" : "You"}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        <form className="assistant-form" onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about games, reps, notes, or scores" />
          <button type="submit" className="primary-button">
            <Send size={18} />
            Send
          </button>
        </form>
      </article>
    </section>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button type="button" className="secondary-button back-button" onClick={onBack}>
      <ChevronLeft size={18} />
      {label}
    </button>
  );
}
