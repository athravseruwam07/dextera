import {
  Accessibility,
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
  ListChecks,
  LogOut,
  Play,
  Pointer,
  Repeat,
  Save,
  Send,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fingerNames, weakestFinger as weakestFingerFromEvents } from "../lib/gesture";
import type {
  CalibrationData,
  CheckIn,
  FingerBends,
  FingerName,
  GameId,
  GestureEvent,
  GestureName,
  PatientCareAppointment,
  PatientCareAssignment,
  Patient,
  RehabSession,
  SessionResult
} from "../types";
import { PatientGame, type GamePlayResult, gameIcons } from "./PatientGames";
import { RehabGameCatalogArt, rehabGameCatalogTagline } from "./RehabGameCatalogArt";
import { PatientInputProvider, inputModeLabels, tapBends, usePatientInput } from "./input";
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

type PatientScreen = "home" | "calendar" | "assistant";

type PatientRoute =
  | { step: "dashboard" }
  | { step: "detail"; assignmentId: string }
  | { step: "tutorial"; assignmentId: string }
  | { step: "calibration"; assignmentId: string }
  | { step: "pre-check"; assignmentId: string }
  | { step: "game"; assignmentId: string }
  | { step: "post-check"; assignmentId: string }
  | { step: "results"; assignmentId: string }
  | { step: "calendar" }
  | { step: "assistant" };

type AssistantMessage = {
  id: string;
  role: "patient" | "assistant";
  text: string;
};

const a11yStorageKey = "gloving.patient.accessibility.v1";

const fingerLabels: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
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

function loadA11y() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(a11yStorageKey) === "true";
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
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

function useAccessibilityMode() {
  const [enabled, setEnabledState] = useState(loadA11y);
  const setEnabled = (value: boolean) => {
    setEnabledState(value);
    window.localStorage.setItem(a11yStorageKey, String(value));
  };
  return [enabled, setEnabled] as const;
}

export function PatientExperience({
  patient,
  screen,
  currentEvent,
  backendConnected,
  onSessionSaved,
  assignedGames,
  clinicAppointments,
  onLogout,
  experienceMode = "patient"
}: {
  patient: Patient;
  screen: PatientScreen;
  currentEvent: GestureEvent;
  backendConnected: boolean;
  onSessionSaved: (session: RehabSession) => void;
  /** When set (including []), replaces mock demo assignments — use clinician-assigned games for this patient only. */
  assignedGames?: PatientCareAssignment[];
  /** When set (including []), replaces mock demo appointments. */
  clinicAppointments?: PatientCareAppointment[];
  /** Clinician Rehab Games sidebar: full catalog preview, disconnected from roster patient assignments. */
  experienceMode?: "patient" | "doctor-library";
  onLogout?: () => void;
}) {
  const [accessibilityMode, setAccessibilityMode] = useAccessibilityMode();
  const [route, setRoute] = useState<PatientRoute>({ step: "dashboard" });
  const [results, setResults] = useState<SessionResult[]>(() => loadSessionResults(patient.id));
  const [calibration, setCalibration] = useState<CalibrationData | undefined>();
  const [preCheck, setPreCheck] = useState<CheckIn | undefined>();
  const [postCheck, setPostCheck] = useState<CheckIn | undefined>();
  const [gameResult, setGameResult] = useState<GamePlayResult | undefined>();
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

  useEffect(() => {
    setResults(loadSessionResults(patient.id));
    setRoute({ step: screen === "calendar" ? "calendar" : screen === "assistant" ? "assistant" : "dashboard" });
  }, [patient.id, screen]);

  const selectedAssignment: PatientCareAssignment | undefined =
    assignments.length === 0
      ? undefined
      : "assignmentId" in route
        ? assignments.find((assignment) => assignment.id === route.assignmentId) ?? assignments[0]
        : assignments[0];

  const routeStep = route.step;

  useEffect(() => {
    if (assignments.length > 0) return;
    if (routeStep === "dashboard" || routeStep === "calendar" || routeStep === "assistant") return;
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
    setSessionStartedAt("");
    setSessionEndedAt("");
    setSaveState("idle");
    setSaveMessage("");
  };

  const startQuickTestGame = (assignment: PatientCareAssignment) => {
    const open = { thumb: 5, index: 5, middle: 5, ring: 5, pinky: 5 };
    const fist = { thumb: 88, index: 92, middle: 92, ring: 90, pinky: 88 };
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
      fingerTaps: {
        thumb: tapBends("thumb"),
        index: tapBends("index"),
        middle: tapBends("middle"),
        ring: tapBends("ring"),
        pinky: tapBends("pinky")
      },
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
          latestResult={results.find((result) => result.assignmentId === a.id)}
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
          accessibilityMode={accessibilityMode}
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
          accessibilityMode={accessibilityMode}
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
          accessibilityMode={accessibilityMode}
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
          appointments={appointments}
          results={results}
          experienceMode={experienceMode}
          onOpenAssignment={(assignmentId) => beginAssignment(assignmentId)}
        />
    );
  })();

  return (
    <PatientInputProvider
      patientId={patient.id}
      smartGloveEvent={currentEvent}
      sessionId={"assignmentId" in route ? route.assignmentId : undefined}
      slowMode={accessibilityMode}
    >
      <section className={`patient-experience ${accessibilityMode ? "patient-a11y" : ""}`}>
        <PatientUtilityBar
          accessibilityMode={accessibilityMode}
          setAccessibilityMode={setAccessibilityMode}
          onHome={() => setRoute({ step: "dashboard" })}
          onCalendar={() => setRoute({ step: "calendar" })}
          onAssistant={() => setRoute({ step: "assistant" })}
          onLogout={onLogout}
        />
        {content}
      </section>
    </PatientInputProvider>
  );
}

function PatientUtilityBar({
  accessibilityMode,
  setAccessibilityMode,
  onHome,
  onCalendar,
  onAssistant,
  onLogout
}: {
  accessibilityMode: boolean;
  setAccessibilityMode: (value: boolean) => void;
  onHome: () => void;
  onCalendar: () => void;
  onAssistant: () => void;
  onLogout?: () => void;
}) {
  return (
    <div className="patient-utility-bar">
      <div className="patient-utility-nav">
        <button type="button" className="secondary-button" onClick={onHome}>
          <ClipboardList size={18} />
          Plan
        </button>
        <button type="button" className="secondary-button" onClick={onCalendar}>
          <CalendarDays size={18} />
          Calendar
        </button>
        <button type="button" className="secondary-button" onClick={onAssistant}>
          <Bot size={18} />
          Assistant
        </button>
      </div>
      <div className="patient-utility-nav">
        <button
          type="button"
          className={`toggle-button ${accessibilityMode ? "is-on" : ""}`}
          onClick={() => setAccessibilityMode(!accessibilityMode)}
        >
          <Accessibility size={18} />
          Accessibility
        </button>
        {onLogout ? (
          <button type="button" className="secondary-button patient-logout-btn" onClick={onLogout} title="Sign out">
            <LogOut size={18} />
            Exit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PatientDashboard({
  patient,
  assignments,
  appointments,
  results,
  experienceMode,
  onOpenAssignment
}: {
  patient: Patient;
  assignments: PatientCareAssignment[];
  appointments: PatientCareAppointment[];
  results: SessionResult[];
  experienceMode: "patient" | "doctor-library";
  onOpenAssignment: (assignmentId: string) => void;
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
      <section className="page-stack rehab-games-doctor-page">
        <div className="rg-shell rg-shell--hero">
          <header className="rg-hero" aria-labelledby="rg-hero-title">
            <span className="rg-kicker">Rehab Games library</span>
            <h2 id="rg-hero-title">Your clinic&apos;s Rehab Games</h2>
            <p className="rg-lead">
              Preview games you prescribe. Patient plans stay in each patient&apos;s workspace.
            </p>
            {assignments[0] ? (
              <button
                type="button"
                className="primary-button rg-hero__cta"
                onClick={() => onOpenAssignment(assignments[0].id)}
              >
                <Play size={17} aria-hidden />
                Try a game preview
              </button>
            ) : null}
          </header>
        </div>

        <div className="rg-shell rg-shell--stats">
          <div className="rg-stats" role="list" aria-label="Library activity">
            <div className="rg-stat rg-stat--minimal" role="listitem">
              <CheckCircle2 className="rg-stat__glyph" size={16} strokeWidth={2} aria-hidden />
              <div className="rg-stat__copy">
                <span className="rg-stat__label">Today</span>
                <strong className="rg-stat__num">{completionToday}%</strong>
              </div>
            </div>
            <div className="rg-stat rg-stat--minimal" role="listitem">
              <Gauge className="rg-stat__glyph" size={16} strokeWidth={2} aria-hidden />
              <div className="rg-stat__copy">
                <span className="rg-stat__label">This week</span>
                <strong className="rg-stat__num">{weeklyReps}</strong>
              </div>
            </div>
            <div className="rg-stat rg-stat--minimal" role="listitem">
              <Sparkles className="rg-stat__glyph" size={16} strokeWidth={2} aria-hidden />
              <div className="rg-stat__copy">
                <span className="rg-stat__label">Streak</span>
                <strong className="rg-stat__num">{streak}d</strong>
              </div>
            </div>
            <div className="rg-stat rg-stat--minimal" role="listitem">
              <CalendarDays className="rg-stat__glyph" size={16} strokeWidth={2} aria-hidden />
              <div className="rg-stat__copy">
                <span className="rg-stat__label">Next visit</span>
                <strong className="rg-stat__num rg-stat__num--sm">
                  {upcomingAppointment ? formatDate(upcomingAppointment.startsAt) : "—"}
                </strong>
              </div>
            </div>
          </div>
        </div>

        <div className="two-column rg-main rg-shell rg-shell--split">
          <article className="rg-catalog">
            <div className="rg-catalog__head">
              <h3 className="rg-catalog__title">Game catalog</h3>
              <p className="rg-catalog__lede">Four modules · each with a distinct training focus</p>
            </div>
            {assignments.length === 0 ? (
              <EmptyState title="No games in catalog" detail="Assignments are injected when you load a roster patient elsewhere." />
            ) : (
              <div className="rg-catalog-grid">
                {assignments.map((assignment) => {
                  const gid = assignment.gameId as GameId;
                  const completed = results.some((result) => result.assignmentId === assignment.id);
                  return (
                    <article className={`rg-game-card rg-game-card--theme-${gid}`} key={assignment.id}>
                      <div className="rg-game-card__viz">
                        <RehabGameCatalogArt gameId={gid} />
                      </div>
                      <div className="rg-game-card__body">
                        <div className="rg-game-card__head-row">
                          <h4 className="rg-game-card__title">{assignment.name}</h4>
                          {completed ? <span className="rg-game-minichip">Logged</span> : null}
                        </div>
                        <p className="rg-game-desc">{rehabGameCatalogTagline(gid)}</p>
                        <div className="rg-game-meta">
                          <span>{assignment.config.targetReps} reps</span>
                          <span className="rg-game-meta-div" aria-hidden>
                            ·
                          </span>
                          <span>{difficultyLabel(assignment.config.difficulty)}</span>
                          <span className="rg-game-meta-div" aria-hidden>
                            ·
                          </span>
                          <span>{assignment.config.frequency}</span>
                        </div>
                        <button
                          type="button"
                          className="rg-game-card__link"
                          onClick={() => onOpenAssignment(assignment.id)}
                        >
                          View details
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          <aside className="rg-snapshot" aria-label="Clinic snapshot">
            <h3 className="rg-snapshot__title">Clinic snapshot</h3>

            <div className="rg-snapshot-row">
              <span className="rg-snapshot-label">Latest result</span>
              {latestResult ? (
                <p className="rg-snapshot-line">
                  <strong>{latestResult.gameName}</strong> · {latestResult.accuracy}% ·{" "}
                  <span className="rg-snapshot-sub">{formatDateTime(latestResult.startedAt)}</span>
                </p>
              ) : (
                <p className="rg-snapshot-line rg-snapshot-muted">No previews saved locally yet.</p>
              )}
            </div>

            <div className="rg-snapshot-row">
              <span className="rg-snapshot-label">Next visit</span>
              {upcomingAppointment ? (
                <p className="rg-snapshot-line">
                  {formatDate(upcomingAppointment.startsAt)} · {upcomingAppointment.title}
                  {upcomingAppointment.location ? ` · ${upcomingAppointment.location}` : ""}
                </p>
              ) : (
                <p className="rg-snapshot-line rg-snapshot-muted">None scheduled · use a patient workspace for dates.</p>
              )}
            </div>

            <div className="rg-snapshot-row rg-snapshot-row--last">
              <span className="rg-snapshot-label">Library</span>
              <p className="rg-snapshot-line rg-snapshot-note">{assignments[0]?.doctorNotes ?? patient.goal}</p>
            </div>
          </aside>
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

function AssignmentDetail({
  assignment,
  latestResult,
  onBack,
  onCalibration,
  onQuickPlay
}: {
  assignment: PatientCareAssignment;
  latestResult?: SessionResult;
  onBack: () => void;
  onCalibration: () => void;
  onQuickPlay: () => void;
}) {
  const tutorial = gameTutorials[assignment.gameId];
  const GameBadgeIcon = gameIcons[assignment.gameId];
  const statusDone = Boolean(latestResult);
  const statusLabel = statusDone ? "Completed" : assignment.status === "missed" ? "Missed" : "Due";

  const skills = assignment.config.targetSkills;
  return (
    <section className={`page-stack pregame-detail pregame-detail--theme-${assignment.gameId}`}>
      <BackButton onBack={onBack} label="Back to Dashboard" />

      <header className="pregame-hero">
        <div className="pregame-hero-grid">
          <div className="pregame-hero-copy">
            <div className="pregame-hero-badges">
              <span className="pregame-mini-badge">
                <GameBadgeIcon size={17} aria-hidden strokeWidth={1.95} /> {tutorial.title}
              </span>
              <span className="pregame-mini-badge subdued">Care plan</span>
            </div>
            <h2 className="pregame-hero-title">{assignment.name}</h2>
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
          <div className="pregame-hero-visual" aria-hidden>
            <div className="pregame-hero-art">
              <RehabGameCatalogArt gameId={assignment.gameId} />
            </div>
          </div>
        </div>
      </header>

      <div className="pregame-stat-grid" role="list">
        <article className="pregame-stat-card pregame-stat-card--reps" role="listitem">
          <span className="pregame-stat-icon-wrap" aria-hidden>
            <Repeat size={17} strokeWidth={2} />
          </span>
          <span className="pregame-stat-label">Target reps</span>
          <strong className="pregame-stat-value">{assignment.config.targetReps}</strong>
          <small className="pregame-stat-hint">{assignment.config.rounds} rounds • ~{assignment.config.estimatedMinutes} min est.</small>
        </article>
        <article className="pregame-stat-card pregame-stat-card--frequency" role="listitem">
          <span className="pregame-stat-icon-wrap" aria-hidden>
            <CalendarClock size={17} strokeWidth={2} />
          </span>
          <span className="pregame-stat-label">Frequency</span>
          <strong className="pregame-stat-value">{assignment.config.frequency}</strong>
          <small className="pregame-stat-hint">Due {formatDate(assignment.dueDate)}</small>
        </article>
        <article className="pregame-stat-card pregame-stat-card--difficulty" role="listitem">
          <span className="pregame-stat-icon-wrap" aria-hidden>
            <Gauge size={17} strokeWidth={2} />
          </span>
          <span className="pregame-stat-label">Difficulty</span>
          <strong className="pregame-stat-value">{difficultyLabel(assignment.config.difficulty)}</strong>
          <small className="pregame-stat-hint">Tune pace in-session if needed</small>
        </article>
        <article
          className={`pregame-stat-card pregame-stat-card--status ${statusDone ? "is-complete" : assignment.status === "missed" ? "is-alert" : "is-neutral"}`}
          role="listitem"
        >
          <span className="pregame-stat-icon-wrap" aria-hidden>
            <CheckCircle2 size={17} strokeWidth={2} />
          </span>
          <span className="pregame-stat-label">Status</span>
          <strong className="pregame-stat-value">{statusLabel}</strong>
          <small className="pregame-stat-hint">{latestResult ? `${latestResult.accuracy}% last accuracy` : "Shows after your first completion"}</small>
        </article>
      </div>

      <section className="pregame-preview-strip" aria-label="Gameplay preview">
        <div className="pregame-preview-caption">
          <span className="pregame-preview-eyebrow">Practice preview</span>
          <p>Light scene from this rehab game — gestures and pacing match your clinician plan.</p>
        </div>
        <div className="pregame-preview-visual">
          <RehabGameCatalogArt gameId={assignment.gameId} />
        </div>
      </section>

      <div className="pregame-lower two-column">
        <div className="pregame-lower-stack">
          <section className="pregame-panel pregame-panel--skills">
            <div className="pregame-panel-head">
              <h3>Target Skills</h3>
              <span>{skills.length} focuses</span>
            </div>
            <div className="pregame-skill-pills">
              {skills.map((skill) => (
                <span key={skill} className="pregame-skill-pill">
                  <Sparkles size={13} aria-hidden strokeWidth={2.25} /> {skill}
                </span>
              ))}
            </div>
          </section>

          <section className="pregame-panel pregame-guidance-panel">
            <div className="pregame-panel-head">
              <h3>Doctor guidance</h3>
              <Stethoscope size={18} strokeWidth={2} aria-hidden />
            </div>
            <div className="pregame-guidance-inner">
              <div className="pregame-guidance-block">
                <div className="pregame-guidance-label">
                  <ClipboardList size={15} aria-hidden strokeWidth={2.25} /> Instructions
                </div>
                <p>{assignment.doctorInstructions}</p>
              </div>
              <div className="pregame-guidance-block pregame-guidance-block--muted">
                <div className="pregame-guidance-label">
                  <Sparkles size={15} aria-hidden strokeWidth={2.25} /> Notes
                </div>
                <p>{assignment.doctorNotes.trim() ? assignment.doctorNotes : "No additional notes for this session."}</p>
              </div>
            </div>
          </section>
        </div>

        <section className="pregame-panel pregame-panel--steps">
          <div className="pregame-panel-head">
            <h3>Before you begin</h3>
            <span>
              <ListChecks size={16} aria-hidden strokeWidth={2.25} /> {tutorial.steps.length} steps
            </span>
          </div>
          <TutorialSteps assignment={assignment} pregame />
        </section>
      </div>
    </section>
  );
}

function TutorialPage({
  assignment,
  accessibilityMode,
  onBack,
  onContinue
}: {
  assignment: PatientCareAssignment;
  accessibilityMode: boolean;
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
        {accessibilityMode && <p className="safe-note">Voice prompts are enabled where the browser supports text-to-speech.</p>}
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
  accessibilityMode,
  onBack,
  onComplete,
  onSkip
}: {
  assignment: PatientCareAssignment;
  accessibilityMode: boolean;
  onBack: () => void;
  onComplete: (calibration: CalibrationData) => void;
  onSkip: () => void;
}) {
  const input = usePatientInput();
  const [steps, setSteps] = useState<CalibrationData["steps"]>({});
  const [fingerTaps, setFingerTaps] = useState<CalibrationData["fingerTaps"]>({});
  const ready =
    steps.open &&
    steps.fist &&
    steps.point &&
    steps.pinch &&
    fingerNames.every((finger) => fingerTaps[finger]);

  const capture = (step: keyof CalibrationData["steps"]) => {
    setSteps((items) => ({ ...items, [step]: input.fingerBends }));
    if (accessibilityMode) speak(`${step} captured`);
  };

  const finish = () => {
    const calibration: CalibrationData = {
      id: `calibration-${Date.now()}`,
      patientId: assignment.patientId,
      assignmentId: assignment.id,
      inputMode: input.inputMode,
      completedAt: new Date().toISOString(),
      steps,
      fingerTaps,
      thresholds: {
        openAverage: averageBend(steps.open),
        fistAverage: averageBend(steps.fist),
        pinchIndexGap: Math.abs((steps.pinch?.thumb ?? 0) - (steps.pinch?.index ?? 0))
      }
    };
    if (steps.open && steps.fist) {
      saveCalibration(assignment.patientId, { open: steps.open, closed: steps.fist }).catch(() => {});
    }
    onComplete(calibration);
  };

  const nextTarget = recommendedCalibrationTarget(steps, fingerTaps);
  const capturedCount = calibrationCapturedCount(steps, fingerTaps);
  const progressPct = Math.round((capturedCount / CALIBRATION_TOTAL_STEPS) * 100);

  return (
    <section className="page-stack patient-flow-page patient-calibration-page">
      <div className="patient-flow-shell">
        <BackButton onBack={onBack} label="Assignment Detail" />

        <header className="surface cal-hero-card">
          <div className="cal-hero-left">
            <div className="cal-hero-kicker">
              <span className="eyebrow">Calibration · Smart glove</span>
              <span className="cal-hero-steps-pill">
                <Activity size={14} aria-hidden strokeWidth={2.25} /> {capturedCount}/{CALIBRATION_TOTAL_STEPS} captured
              </span>
            </div>
            <h2 className="cal-hero-title">Set Up the Smart Glove</h2>
            <p className="cal-hero-copy">
              We capture relaxed open, fist, point, pinch, and one tap per finger so games grade movement against{' '}
              <em>your</em> glove range — not generic defaults.
            </p>
            <div className="cal-progress-shell" aria-label="Calibration completion">
              <div className="cal-progress-bar-wrap">
                <div
                  className="cal-progress-bar"
                  role="progressbar"
                  aria-valuenow={capturedCount}
                  aria-valuemin={0}
                  aria-valuemax={CALIBRATION_TOTAL_STEPS}
                  aria-valuetext={`${capturedCount} of ${CALIBRATION_TOTAL_STEPS} steps`}
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
              Live glove preview — bend your fingers
            </p>
          </div>
        </header>

        <div className="cal-gesture-grid">
          {CALIBRATION_GESTURES.map(({ key: stepKey, label, hint, Icon, palette }) => {
            const captured = Boolean(steps[stepKey]);
            const isNext = nextTarget === stepKey;
            return (
              <article
                key={stepKey}
                className={[
                  "cal-gesture-card",
                  `cal-gesture-card--${palette}`,
                  captured ? "is-captured" : "",
                  isNext ? "is-next" : "",
                  captured ? "" : "is-pending"
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="cal-gesture-card__head">
                  <span className="cal-gesture-icon" aria-hidden>
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <div className="cal-gesture-card__titles">
                    <h3>{label}</h3>
                    <span className={`cal-status ${captured ? "cal-status--ok" : isNext ? "cal-status--next" : "cal-status--muted"}`}>
                      {captured ? (
                        <>
                          <CheckCircle2 size={13} aria-hidden strokeWidth={2.25} /> Captured
                        </>
                      ) : isNext ? (
                        <>Active · next capture</>
                      ) : (
                        <>Not captured</>
                      )}
                    </span>
                  </div>
                </div>
                <p className="cal-gesture-hint">{hint}</p>
                {captured && <p className="cal-gesture-measure">{averageBend(steps[stepKey])}% avg bend</p>}
                <button type="button" className="cal-gesture-capture" onClick={() => capture(stepKey)}>
                  {captured ? "Recapture" : "Capture"}
                </button>
              </article>
            );
          })}
        </div>

        <section className="surface cal-finger-panel" aria-labelledby="cal-finger-heading">
          <div className="cal-finger-panel__intro">
            <div>
              <h3 id="cal-finger-heading">Tap each finger</h3>
              <p>Lightly tap once per finger — the glove records your tap signature.</p>
            </div>
            <span className={`cal-status ${fingerNames.every((f) => fingerTaps[f]) ? "cal-status--ok" : ""}`}>
              {fingerNames.filter((f) => fingerTaps[f]).length}/{fingerNames.length} fingers
            </span>
          </div>
          <div className="cal-finger-strip" role="list">
            {fingerNames.map((finger, fi) => {
              const tapped = Boolean(fingerTaps[finger]);
              const fingerNext = nextTarget === finger;
              return (
                <button
                  type="button"
                  key={finger}
                  role="listitem"
                  className={[
                    "cal-finger-pill",
                    tapped ? "is-captured" : "",
                    fingerNext ? "is-next" : "",
                    tapped ? "" : "is-pending"
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    const gesture = `tap_${finger}` as GestureName;
                    const event = input.emitGesture(gesture, tapBends(finger));
                    setFingerTaps((items) => ({
                      ...items,
                      [finger]: {
                        thumb: event.thumb,
                        index: event.index,
                        middle: event.middle,
                        ring: event.ring,
                        pinky: event.pinky
                      }
                    }));
                    if (accessibilityMode) speak(`${fingerLabels[finger]} tap captured`);
                  }}
                >
                  <span className="cal-finger-pill__ix" aria-hidden>
                    {fi + 1}
                  </span>
                  <span className="cal-finger-pill__name">{fingerLabels[finger]}</span>
                  <span className="cal-finger-pill__state">{tapped ? "Captured" : fingerNext ? "Next" : "Tap"}</span>
                  {tapped ? <CheckCircle2 className="cal-finger-pill__check" size={14} aria-hidden strokeWidth={2.5} /> : null}
                </button>
              );
            })}
          </div>
        </section>

        {!ready && (
          <p className="cal-footer-hint safe-note">
            Capture every gesture and finger so we can personalize feedback before you train.
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
