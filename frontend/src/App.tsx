import {
  Activity,
  CalendarDays,
  CircleDot,
  ClipboardList,
  Maximize2,
  Home,
  LogOut,
  Minimize2,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Timer,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { exerciseTemplates, createGestureEvent, nextGesture, seedPatients } from "./data/mockData";
import {
  checkBackendHealth,
  connectGestureStream,
  createAppointment,
  createAssignment,
  createExerciseAssignment,
  createBackendPatientProfile,
  deleteAssignment,
  deleteExerciseAssignment,
  endBackendSession,
  fetchAlerts,
  fetchAppointments,
  fetchAssignments,
  fetchBackendPatient,
  fetchBackendPatientSummaries,
  fetchDifficultyRecommendation,
  fetchExerciseAssignments,
  generateAiSummary,
  requestFakeGestureForSession,
  requestFakeGesture,
  savePatientNotes,
  startBackendSession,
  syncTherapistProfile,
  updateExerciseAssignment
} from "./lib/backend";
import {
  detectWeakestFinger,
  getAverageAccuracy,
  getDifficultyRecommendation as getLocalDifficultyRecommendation,
  getAccuracyTrend,
  getImprovementPercent,
  getLatestAccuracy,
  getPainFatigueTrend,
  getRepsTrend,
  getWeeklyCompletionRate,
  unresolvedAlerts
} from "./lib/doctorAnalytics";
import { supabase } from "./lib/supabase";
import {
  fingerNames,
  gestureLabels,
  sessionFromDraft,
  summarizePatient
} from "./lib/gesture";
import type {
  ExerciseTemplate,
  FingerBends,
  FingerName,
  GestureEvent,
  GestureName,
  AiProgressSummary,
  Alert,
  Appointment,
  Assignment,
  DifficultyRecommendation,
  Game,
  Patient,
  PatientTab,
  RehabSession,
  SessionDraft,
  ViewName
} from "./types";
import { PatientExperience, type PatientExerciseRouteStep, type PatientScreen } from "./patient/PatientExperience";
import { useGloveData } from "./lib/useGloveData";
import { Canvas } from "@react-three/fiber";
import { HandModel3D } from "./vr/components/HandModel3D";
import { HandMovementSection } from "./vr/components/HandMovementSection";
import { fetchCalibration, saveCalibration } from "./patient/patientApi";
import { calibratedBendsFromRaw } from "./patient/ballPickupGrip";
import {
  createDoctorGameLibraryPatient,
  doctorAppointmentToPatientCare,
  doctorAssignmentsToPatientCare,
} from "./patient/patientData";
import heroImage from "./assets/dextera-hero.png";
import { ExercisesPage } from "./exercises/ExercisesPage";
import type { ExerciseAssignment } from "./data/exercises";

type AuthRole = "doctor" | "patient";
type EntryScreen = "landing" | "login";

const productionDoctorAccount = {
  email: "doctor@dextera.app",
  password: "DexteraDoctor2026!"
};

function mergeExerciseAssignments(...lists: ExerciseAssignment[][]): ExerciseAssignment[] {
  const byKey = new Map<string, ExerciseAssignment>();
  for (const assignment of lists.flat()) {
    byKey.set(`${assignment.patientId}:${assignment.exerciseId}`, assignment);
  }
  return Array.from(byKey.values()).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

function markExerciseAssignmentCompleted(
  assignment: ExerciseAssignment,
  result: NonNullable<ExerciseAssignment["result"]>,
  completedAt = new Date().toISOString()
): ExerciseAssignment {
  return {
    ...assignment,
    status: "completed",
    completedAt,
    result
  };
}

const localPatientSessionKey = "dextera.localPatientSession.v1";
const localExerciseAssignmentsKey = "dextera.exerciseAssignments.v1";

type LocalPatientSession = {
  email: string;
  fullName?: string;
};

function readLocalPatientSession(): LocalPatientSession | null {
  try {
    const raw = localStorage.getItem(localPatientSessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPatientSession>;
    return parsed.email ? { email: parsed.email, fullName: parsed.fullName } : null;
  } catch {
    return null;
  }
}

function writeLocalPatientSession(session: LocalPatientSession) {
  try {
    localStorage.setItem(localPatientSessionKey, JSON.stringify(session));
  } catch {
    // Ignore storage failures; the current login flow can still continue in memory.
  }
}

function clearLocalPatientSession() {
  try {
    localStorage.removeItem(localPatientSessionKey);
  } catch {
    // Ignore storage failures on logout.
  }
}

function readLocalExerciseAssignments(): ExerciseAssignment[] {
  try {
    const raw = localStorage.getItem(localExerciseAssignmentsKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ExerciseAssignment =>
      Boolean(
        item &&
        typeof item.id === "string" &&
        typeof item.patientId === "string" &&
        typeof item.exerciseId === "string" &&
        typeof item.assignedAt === "string" &&
        (item.status === "assigned" || item.status === "completed")
      )
    );
  } catch {
    return [];
  }
}

function writeLocalExerciseAssignments(assignments: ExerciseAssignment[]) {
  try {
    localStorage.setItem(localExerciseAssignmentsKey, JSON.stringify(assignments));
  } catch {
    // Ignore storage failures; server state or in-memory state can still drive the UI.
  }
}

type AppRoute =
  | { kind: "landing" }
  | { kind: "sign-in"; role: AuthRole }
  | { kind: "doctor"; view: ViewName; patientId?: string; patientTab?: PatientTab }
  | { kind: "patient"; screen: PatientScreen; exerciseAssignmentId?: string; exerciseStep?: PatientExerciseRouteStep };

const rehabGameViews: ViewName[] = ["rehab-games", "rehab-calendar", "rehab-assistant"];

const doctorViewPaths: Partial<Record<ViewName, string>> = {
  dashboard: "/doctor/dashboard",
  patients: "/doctor/patients",
  appointments: "/doctor/appointments",
  "rehab-games": "/doctor/rehab-games",
  "rehab-calendar": "/doctor/rehab-calendar",
  "rehab-assistant": "/doctor/rehab-assistant",
  exercises: "/doctor/exercises",
  "glove-dev": "/doctor/glove-dev"
};

const patientScreenPaths: Record<PatientScreen, string> = {
  home: "/patient/plan",
  games: "/patient/rehab-games",
  calendar: "/patient/calendar",
  progress: "/patient/progress",
  assistant: "/patient/assistant"
};

function pathForPatientExercise(assignmentId: string, step: PatientExerciseRouteStep) {
  return `/patient/exercises/${encodeURIComponent(assignmentId)}/${step}`;
}

function normalizePathname(pathname: string) {
  const clean = pathname.replace(/\/+$/, "");
  return clean || "/";
}

function pathForDoctorView(view: ViewName, patientId: string, patientTab: PatientTab) {
  if (view === "patient") return `/doctor/patients/${encodeURIComponent(patientId)}/${patientTab}`;
  return doctorViewPaths[view] ?? "/doctor/dashboard";
}

function parseAppRoute(pathname: string): AppRoute {
  const path = normalizePathname(pathname);
  const segments = path.split("/").filter(Boolean);
  if (path === "/") return { kind: "landing" };
  if (path === "/doctor/sign-in") return { kind: "sign-in", role: "doctor" };
  if (path === "/patient/sign-in") return { kind: "sign-in", role: "patient" };

  if (segments[0] === "patient") {
    if (segments[1] === "exercises" && segments[2]) {
      const step = segments[3] === "play" || segments[3] === "results" ? segments[3] : "detail";
      return {
        kind: "patient",
        screen: "home",
        exerciseAssignmentId: decodeURIComponent(segments[2]),
        exerciseStep: step
      };
    }
    const screen = segments[1] as PatientScreen | undefined;
    if (screen === "calendar" || screen === "progress" || screen === "assistant") return { kind: "patient", screen };
    if (segments[1] === "rehab-games" || segments[1] === "games") return { kind: "patient", screen: "games" };
    return { kind: "patient", screen: "home" };
  }

  if (segments[0] === "doctor") {
    if (segments[1] === "patients" && segments[2]) {
      const tab = segments[3] as PatientTab | undefined;
      return {
        kind: "doctor",
        view: "patient",
        patientId: decodeURIComponent(segments[2]),
        patientTab: tab === "plan" || tab === "sessions" || tab === "live" || tab === "appointments" || tab === "notes" ? tab : "overview"
      };
    }
    const viewBySegment: Record<string, ViewName> = {
      dashboard: "dashboard",
      patients: "patients",
      appointments: "appointments",
      "rehab-games": "rehab-games",
      "rehab-calendar": "rehab-calendar",
      "rehab-assistant": "rehab-assistant",
      exercises: "exercises",
      "glove-dev": "glove-dev"
    };
    return { kind: "doctor", view: viewBySegment[segments[1] ?? "dashboard"] ?? "dashboard" };
  }

  return { kind: "landing" };
}

function sideNavActive(navId: ViewName, current: ViewName) {
  if (navId === "rehab-games") return rehabGameViews.includes(current);
  return navId === current;
}

const viewItems: Array<{
  id: ViewName;
  label: string;
  icon: typeof Users;
}> = [
  { id: "dashboard", label: "Dashboard", icon: ClipboardList },
  { id: "patients", label: "Patients", icon: Users },
  { id: "appointments", label: "Appointments", icon: CalendarDays },
  { id: "rehab-games", label: "Rehab Games", icon: Home },
  { id: "exercises", label: "Exercises", icon: Sparkles },
  { id: "glove-dev", label: "Glove Dev", icon: Activity }
];

const fingerLabels: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

const demoDoctor = {
  id: "doctor-1",
  name: "Dr. Singh",
  specialty: "Physiotherapist"
};

const demoPatientIds = new Set(["patient-1", "patient-2", "patient-3", "demo-patient-1", "demo-patient-2", "demo-patient-3"]);
const demoPatientNames = new Set(["Maya Patel", "Daniel Lee", "Amira Khan"]);

function isDemoPatient(patient: Pick<Patient, "id" | "name">) {
  return demoPatientIds.has(patient.id) || demoPatientNames.has(patient.name);
}

const strongestGames: Game[] = [
  {
    id: "ball-pickup",
    name: "Ball Pickup",
    description: "Grab balls with fist and release with open hand.",
    targetSkills: ["grip control", "release control", "hand-eye coordination", "finger flexion", "finger extension"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "medium",
    route: "/vr"
  },
  {
    id: "finger-tap-piano",
    name: "Finger Tap Piano",
    description: "Tap individual fingers to improve timing and isolation.",
    targetSkills: ["finger isolation", "timing", "dexterity", "coordination"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "easy"
  },
  {
    id: "bubble-pop",
    name: "Bubble Pop",
    description: "Point and reach to pop targets.",
    targetSkills: ["reach", "pointing", "reaction time", "hand-eye coordination"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "easy"
  },
  {
    id: "carrom-flick",
    name: "Carrom",
    description: "Practice finger extension, force control, and precision.",
    targetSkills: ["finger extension", "flick control", "aim", "force control", "precision"],
    supportedInputModes: ["camera", "glove", "demo"],
    defaultDifficulty: "medium"
  }
];

const gameDefaults: Record<string, { targetSkill: string; reps?: number; rounds?: number }> = {
  "ball-pickup": { targetSkill: "grip and release control", reps: 10 },
  "finger-tap-piano": { targetSkill: "finger isolation and timing", rounds: 3 },
  "bubble-pop": { targetSkill: "reach and reaction time", rounds: 2 },
  "carrom-flick": { targetSkill: "finger extension and precision", reps: 5 }
};

function futureDate(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function pastDate(days: number) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

const demoAssignments: Assignment[] = [
  {
    id: "assignment-maya-ball",
    patientId: "patient-1",
    doctorId: "doctor-1",
    gameId: "ball-pickup",
    gameName: "Ball Pickup",
    difficulty: "medium",
    reps: 10,
    rounds: null,
    frequency: "daily",
    dueDate: futureDate(1),
    targetSkill: "grip and release control",
    notes: "Prioritize controlled release.",
    status: "assigned",
    createdAt: new Date().toISOString()
  },
  {
    id: "assignment-maya-piano",
    patientId: "patient-1",
    doctorId: "doctor-1",
    gameId: "finger-tap-piano",
    gameName: "Finger Tap Piano",
    difficulty: "easy",
    reps: null,
    rounds: 3,
    frequency: "3x/week",
    dueDate: futureDate(3),
    targetSkill: "finger isolation and timing",
    notes: "Watch ring finger independence.",
    status: "assigned",
    createdAt: new Date().toISOString()
  },
  {
    id: "assignment-daniel-bubble",
    patientId: "patient-2",
    doctorId: "doctor-1",
    gameId: "bubble-pop",
    gameName: "Bubble Pop",
    difficulty: "easy",
    reps: null,
    rounds: 2,
    frequency: "daily",
    dueDate: pastDate(2),
    targetSkill: "reach and reaction time",
    notes: "Missed target date. Review adherence.",
    status: "missed",
    createdAt: new Date().toISOString()
  },
  {
    id: "assignment-amira-carrom",
    patientId: "patient-3",
    doctorId: "doctor-1",
    gameId: "carrom-flick",
    gameName: "Carrom",
    difficulty: "medium",
    reps: 5,
    rounds: null,
    frequency: "2x/week",
    dueDate: futureDate(4),
    targetSkill: "finger extension and precision",
    notes: "Controlled flicks before increasing force.",
    status: "assigned",
    createdAt: new Date().toISOString()
  }
];

const demoAppointments: Appointment[] = [
  {
    id: "appointment-maya",
    patientId: "patient-1",
    doctorId: "doctor-1",
    date: futureDate(3),
    time: "10:30",
    type: "Progress check-in",
    notes: "Review Ball Pickup release timing.",
    status: "scheduled"
  },
  {
    id: "appointment-daniel",
    patientId: "patient-2",
    doctorId: "doctor-1",
    date: futureDate(1),
    time: "14:00",
    type: "Pain/fatigue review",
    notes: "Discuss adherence and pain increase.",
    status: "scheduled"
  }
];

const demoAlerts: Alert[] = [
  {
    id: "alert-maya-ring",
    patientId: "patient-1",
    type: "weak_finger",
    severity: "medium",
    title: "Ring finger weakness",
    message: "Ring finger weakness detected across recent sessions.",
    createdAt: new Date().toISOString(),
    resolved: false
  },
  {
    id: "alert-daniel-adherence",
    patientId: "patient-2",
    type: "low_adherence",
    severity: "high",
    title: "Low adherence",
    message: "Daniel completed fewer than half of assigned sessions this week.",
    createdAt: new Date().toISOString(),
    resolved: false
  },
  {
    id: "alert-daniel-missed",
    patientId: "patient-2",
    type: "missed_session",
    severity: "medium",
    title: "Missed session",
    message: "Daniel missed Bubble Pop after the due date.",
    createdAt: new Date().toISOString(),
    resolved: false
  },
  {
    id: "alert-daniel-pain",
    patientId: "patient-2",
    type: "pain_increase",
    severity: "high",
    title: "Pain increased",
    message: "Daniel reported pain increasing from 2/10 to 6/10 after Bubble Pop.",
    createdAt: new Date().toISOString(),
    resolved: false
  }
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function LandingPage({ onSelectRole }: { onSelectRole: (role: AuthRole) => void }) {
  return (
    <main className="landing-page">
      <section className="landing-hero landing-hero-split">
        <header className="landing-nav">
          <div className="landing-brand">
            <div className="brand-mark small">
              <Activity size={21} />
            </div>
            <span>Dextera</span>
          </div>
          <div className="landing-nav-actions">
            <button className="secondary-button glass-button" type="button" onClick={() => onSelectRole("patient")}>
              Patient sign in
            </button>
            <button className="primary-button" type="button" onClick={() => onSelectRole("doctor")}>
              Doctor sign in
            </button>
          </div>
        </header>

        <div className="landing-copy">
          <span className="landing-kicker">Clinical hand-rehab command center</span>
          <h1>Rehab that feels like play. Progress that clinicians can trust.</h1>
          <p>
            Dextera turns hand therapy into interactive games powered by camera tracking, optional smart glove input,
            and clinician-guided care plans.
          </p>
          <div className="landing-actions">
            <button className="primary-button" type="button" onClick={() => onSelectRole("doctor")}>
              <UserRound size={18} />
              Continue as doctor
            </button>
            <button className="secondary-button glass-button" type="button" onClick={() => onSelectRole("patient")}>
              <Play size={18} />
              Continue as patient
            </button>
          </div>
        </div>

        <aside className="landing-preview" aria-label="Dextera product preview">
          <img src={heroImage} alt="Dextera rehabilitation dashboard preview" />
          <div className="preview-card preview-patient">
            <span>Live session</span>
            <strong>Maya Patel</strong>
            <p>Ball Pickup · Current gesture: Fist</p>
          </div>
          <div className="preview-card preview-metrics">
            <div><span>Accuracy</span><strong>80%</strong></div>
            <div><span>Weakest</span><strong>Ring</strong></div>
          </div>
          <div className="preview-card preview-bars">
            <FingerBars event={createGestureEvent("patient-1", "fist")} />
          </div>
        </aside>
      </section>

      <section className="landing-band">
        <article>
          <strong>Clinician-assigned care plans</strong>
          <p>Assign Ball Pickup, Finger Tap Piano, Bubble Pop, and Carrom from one workspace.</p>
        </article>
        <article>
          <strong>Camera, glove, or simulator input</strong>
          <p>Finger bend, gesture, pain, fatigue, and session results flow into the dashboard.</p>
        </article>
        <article>
          <strong>AI progress summaries</strong>
          <p>Clinicians see adherence, weak fingers, alerts, and recommendations without automatic plan changes.</p>
        </article>
      </section>
    </main>
  );
}

function LoginPage({
  role,
  onLogin
}: {
  role: AuthRole;
  onLogin: (email: string, fullName?: string) => Promise<void> | void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(role === "doctor" ? productionDoctorAccount.email : "");
  const [password, setPassword] = useState(role === "doctor" ? productionDoctorAccount.password : "");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (role === "doctor" && email.trim().toLowerCase() !== productionDoctorAccount.email) {
      setError("Use the clinic doctor account.");
      return;
    }
    if (isSignUp && !fullName.trim()) {
      setError("Enter your full name.");
      return;
    }

    if (!supabase) {
      await onLogin(email, fullName);
      return;
    }

    setLoading(true);

    if (isSignUp) {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim(), role: "patient" } }
      });
      setLoading(false);
      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        await onLogin(email, fullName);
      } else {
        setMessage("Account created. Check your email to confirm, then sign in.");
        setIsSignUp(false);
      }
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (authError) {
        setError(authError.message);
      } else {
        await onLogin(email, fullName);
      }
    }
  };

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="brand-mark">
          <Activity size={28} />
        </div>
        <div>
          <span className="eyebrow">Dextera</span>
          <h1>{role === "doctor" ? "Doctor sign in" : isSignUp ? "Create patient account" : "Patient sign in"}</h1>
          <p>
            {role === "doctor"
              ? "Access your rehab workspace."
              : "Use your own account to view your care plan and sessions."}
          </p>
        </div>
        {isSignUp ? (
          <label>
            Full name
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Maya Patel"
              required
            />
          </label>
        ) : null}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>
        {error && <p style={{ color: "var(--red, #ef4444)", fontSize: "0.875rem" }}>{error}</p>}
        {message && <p style={{ color: "var(--teal, #0f766e)", fontSize: "0.875rem" }}>{message}</p>}
        <button className="primary-button" type="submit" disabled={loading}>
          <Send size={18} />
          {loading ? (isSignUp ? "Creating account…" : "Signing in…") : (isSignUp ? "Create account" : role === "doctor" ? "Enter doctor dashboard" : "Enter patient portal")}
        </button>
        {role === "patient" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => { setIsSignUp((value) => !value); setError(""); setMessage(""); }}
          >
            {isSignUp ? "Already have an account? Sign in" : "Create patient account"}
          </button>
        ) : null}
      </form>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "blue"
}: {
  label: string;
  value: string | number;
  detail: string;
	  icon: typeof Activity;
	  tone?: "blue" | "teal" | "amber" | "red" | "violet";
	}) {
	  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function InlineAlert({
  tone = "info",
  children
}: {
  tone?: "info" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return <div className={`inline-alert inline-alert-${tone}`}>{children}</div>;
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

function GestureBadge({ gesture }: { gesture: GestureName }) {
  return <span className={`gesture-badge gesture-${gesture}`}>{gestureLabels[gesture]}</span>;
}

function FingerBars({ event }: { event: GestureEvent }) {
  return (
    <div className="finger-bars">
      {fingerNames.map((finger) => (
        <div className="finger-row" key={finger}>
          <span>{fingerLabels[finger]}</span>
          <div className="bar-track" aria-label={`${fingerLabels[finger]} ${event[finger]}%`}>
            <div className="bar-fill" style={{ width: `${event[finger]}%` }} />
          </div>
          <strong>{event[finger]}%</strong>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Patient["status"] | Assignment["status"] | Appointment["status"] }) {
  return <span className={`status-pill status-${status}`}>{String(status).replace(/_/g, " ")}</span>;
}

function SeverityBadge({ severity }: { severity: Alert["severity"] }) {
  return <span className={`severity-badge severity-${severity}`}>{severity}</span>;
}

function patientSessionsThisWeek(patient: Patient) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return patient.sessions.filter((session) => Date.now() - new Date(session.startedAt).getTime() <= weekMs).length;
}

function patientAlerts(patientId: string, alerts: Alert[]) {
  return unresolvedAlerts(alerts).filter((alert) => alert.patientId === patientId);
}

function patientAssignments(patientId: string, assignments: Assignment[]) {
  return assignments.filter((assignment) => assignment.patientId === patientId);
}

function exerciseFromAssignment(assignment: Assignment): ExerciseTemplate {
  const template = exerciseTemplates.find((exercise) => exercise.id === assignment.gameId);
  return {
    id: assignment.gameId,
    name: assignment.gameName,
    goal: assignment.targetSkill,
    targetGesture: template?.targetGesture || "fist",
    durationMinutes: template?.durationMinutes || 8,
    targetReps: assignment.reps || assignment.rounds || template?.targetReps || 10,
    difficulty: assignment.difficulty,
    instructions: assignment.notes || template?.instructions || "Complete the assigned rehab exercise."
  };
}

function PatientWorkspaceShell({
  patient,
  assignments,
  activeTab,
  onTabChange,
  onBack,
  children
}: {
	  patient: Patient;
	  assignments: Assignment[];
  activeTab: PatientTab;
  onTabChange: (tab: PatientTab) => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
	  const tabs: Array<{ id: PatientTab; label: string }> = [
	    { id: "overview", label: "Overview" },
	    { id: "plan", label: "Care Plan" },
	    { id: "sessions", label: "Sessions" },
	    { id: "live", label: "Live Monitor" },
	    { id: "appointments", label: "Appointments" },
	    { id: "notes", label: "Notes" }
	  ];
	  const latestAccuracy = getLatestAccuracy(patient.id, patient.sessions);
	  const adherence = getWeeklyCompletionRate(patient.id, assignments, patient.sessions);
	  const weakest = detectWeakestFinger(patient.sessions);

  return (
    <section className="page-stack">
      <div className={`profile-hero patient-summary-card ${activeTab === "plan" ? "patient-summary-card--plan" : ""}`}>
	        <div>
	          <span className="eyebrow">Patient workspace</span>
	          <h2>{patient.name}</h2>
	          <p>{patient.condition || patient.diagnosis} · {patient.affectedHand || "right"} hand</p>
	          <p>Goal: {patient.recoveryGoal || patient.goal}</p>
	        </div>
	        <div className="summary-metrics">
	          <span>Latest accuracy <strong>{latestAccuracy}%</strong></span>
	          <span>Adherence <strong>{adherence}%</strong></span>
	          <span>Weakest <strong>{fingerLabels[weakest.weakestFinger]}</strong></span>
	        </div>
	        <div className="profile-actions">
	          <StatusBadge status={patient.status} />
          <button className="secondary-button" type="button" onClick={onBack}>
            <Users size={17} />
            Back to dashboard
          </button>
        </div>
      </div>
      <div className="patient-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}

function DoctorDashboardPage({
  patients,
  assignments,
  alerts,
  appointments,
  onSelectPatient
}: {
  patients: Patient[];
  assignments: Assignment[];
  alerts: Alert[];
  appointments: Appointment[];
  onSelectPatient: (id: string) => void;
}) {
  const [dashboardModal, setDashboardModal] = useState<"alerts" | "appointments" | null>(null);
  const activeAssignments = assignments.filter((assignment) => assignment.status === "assigned").length;
  const sessionsThisWeek = patients.reduce((sum, patient) => sum + patientSessionsThisWeek(patient), 0);
  const activeAlerts = unresolvedAlerts(alerts);
  const dashboardPreviewLimit = 2;
  const visibleAlerts = activeAlerts.slice(0, dashboardPreviewLimit);
  const hiddenAlertCount = Math.max(activeAlerts.length - visibleAlerts.length, 0);
  const scheduledAppointments = appointments.filter((appointment) => appointment.status === "scheduled");
  const visibleAppointments = scheduledAppointments.slice(0, dashboardPreviewLimit);
  const hiddenAppointmentCount = Math.max(scheduledAppointments.length - visibleAppointments.length, 0);
  const statusRank: Record<string, number> = { needs_review: 0, low_adherence: 1, review: 2, improving: 3, stable: 4, active: 5, paused: 6 };
  const sortedPatients = patients.slice().sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9));
  const recentSessions = patients
    .flatMap((patient) => patient.sessions.map((session) => ({ patient, session })))
    .sort((a, b) => new Date(b.session.startedAt).getTime() - new Date(a.session.startedAt).getTime())
    .slice(0, 4);
  const patientsNeedingReview = patients.filter((patient) => ["needs_review", "low_adherence", "review"].includes(patient.status)).length;
  const openPatientFromModal = (patientId: string) => {
    setDashboardModal(null);
    onSelectPatient(patientId);
  };

  useEffect(() => {
    if (!dashboardModal) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDashboardModal(null);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dashboardModal]);

  return (
    <section className="page-stack">
	      <div className="page-heading">
	        <div>
	          <span className="eyebrow">Clinic triage</span>
	          <h2>Doctor Dashboard</h2>
	          <p>Monitor patients, review alerts, and assign hand-rehab exercises.</p>
	        </div>
        <div className="doctor-chip">
          <UserRound size={18} />
          <span>{demoDoctor.name}</span>
          <small>{demoDoctor.specialty}</small>
        </div>
      </div>

      <div className="metric-grid doctor-metric-grid">
	        <MetricCard label="Total patients" value={patients.length} detail="active roster" icon={Users} />
	        <MetricCard label="Needs review" value={patientsNeedingReview} detail="triage priority" icon={CircleDot} tone="red" />
	        <MetricCard label="Sessions this week" value={sessionsThisWeek} detail="recorded sessions" icon={Activity} tone="amber" />
	        <MetricCard label="Active assignments" value={activeAssignments} detail="currently assigned" icon={ClipboardList} tone="teal" />
	      </div>

	      <div className="two-column dashboard-review-grid">
	        <article className="surface dashboard-list-panel">
	          <div className="section-title">
	            <h3>Alerts needing review</h3>
	            <span>{activeAlerts.length} active</span>
          </div>
          <div className="stack-list dashboard-preview-list">
	            {activeAlerts.length === 0 ? (
	              <EmptyState title="No active alerts" description="All patients are clear for the current review window." />
	            ) : (
	              visibleAlerts.map((alert) => {
                const patient = patients.find((item) => item.id === alert.patientId);
                return (
	                  <div className="list-card dashboard-preview-card" key={alert.id}>
                    <div className="section-title">
                      <strong>{alert.title}</strong>
                      <SeverityBadge severity={alert.severity} />
                    </div>
	                    <p>{patient?.name}: {alert.message}</p>
	                    <button className="link-button" type="button" onClick={() => onSelectPatient(alert.patientId)}>
	                      View patient
	                    </button>
	                  </div>
                );
              })
            )}
          </div>
          {hiddenAlertCount > 0 && (
            <button className="dashboard-more-link" type="button" onClick={() => setDashboardModal("alerts")}>
              View {hiddenAlertCount}+ more
            </button>
          )}
        </article>

	        <article className="surface dashboard-list-panel">
          <div className="section-title">
            <h3>Upcoming appointments</h3>
            <span>{scheduledAppointments.length} scheduled</span>
          </div>
	          <div className="stack-list dashboard-preview-list">
	            {scheduledAppointments.length === 0 ? (
	              <EmptyState title="No upcoming appointments" description="No scheduled visits in the current review window." />
	            ) : visibleAppointments.map((appointment) => {
              const patient = patients.find((item) => item.id === appointment.patientId);
              return (
                <div className="list-card dashboard-preview-card" key={appointment.id}>
                  <strong>{patient?.name || appointment.patientId}</strong>
                  <p>{appointment.date} at {appointment.time} · {appointment.type}</p>
                  <button className="link-button" type="button" onClick={() => onSelectPatient(appointment.patientId)}>
                    View patient
                  </button>
                </div>
              );
            })}
	          </div>
          {hiddenAppointmentCount > 0 && (
            <button className="dashboard-more-link" type="button" onClick={() => setDashboardModal("appointments")}>
              View {hiddenAppointmentCount}+ more
            </button>
          )}
	        </article>
	      </div>

	      <article className="surface">
	        <div className="section-title">
	          <h3>Patient roster</h3>
	          <span>Sorted by triage priority</span>
	        </div>
	        <div className="patient-grid">
	          {sortedPatients.map((patient) => {
	            const sessions = patient.sessions;
	            const latestAccuracy = getLatestAccuracy(patient.id, sessions);
	            const adherence = getWeeklyCompletionRate(patient.id, assignments, sessions);
	            const weakest = detectWeakestFinger(sessions);
	            const alertsForPatient = patientAlerts(patient.id, alerts);
	            return (
	              <article className="patient-card" key={patient.id}>
	                <div className="patient-card-head">
	                  <div className="avatar">{patient.name.slice(0, 1)}</div>
	                  <div>
	                    <h3>{patient.name}</h3>
	                    <p>{patient.condition || patient.diagnosis}</p>
	                  </div>
	                  <StatusBadge status={patient.status} />
	                </div>
	                <p className="patient-goal">Goal: {patient.recoveryGoal || patient.goal}</p>
	                <ProgressBar label="Adherence" percent={adherence} />
	                <div className="patient-stat-row">
	                  <span>{patientSessionsThisWeek(patient)} sessions this week</span>
	                  <span>{latestAccuracy}% latest accuracy</span>
	                  <span>Weakest: {fingerLabels[weakest.weakestFinger]}</span>
	                  <span>{alertsForPatient.length} alerts</span>
	                </div>
	                <button className="secondary-button" onClick={() => onSelectPatient(patient.id)}>
	                  <UserRound size={17} />
	                  View patient
	                </button>
	              </article>
	            );
	          })}
	        </div>
	      </article>

	      <article className="surface">
	        <div className="section-title">
	          <h3>Recent activity</h3>
	          <span>Latest saved sessions</span>
	        </div>
	        <div className="stack-list compact-activity">
	          {recentSessions.map(({ patient, session }) => (
	            <div className="list-card compact-list-card" key={`${patient.id}-${session.id}`}>
	              <strong>{patient.name} · {session.gameName || session.exerciseName}</strong>
	              <p>{formatShortDate(session.startedAt)} · {session.repsCompleted}/{session.repsRequired || session.targetReps} reps · {session.accuracy ?? session.averageAccuracy}% accuracy</p>
	            </div>
	          ))}
	        </div>
	      </article>

      {dashboardModal ? (
        <div className="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-modal-title">
          <button className="dashboard-modal-backdrop" type="button" aria-label="Close dashboard dialog" onClick={() => setDashboardModal(null)} />
          <article className="dashboard-modal-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">{dashboardModal === "alerts" ? `${activeAlerts.length} active` : `${scheduledAppointments.length} scheduled`}</span>
                <h3 id="dashboard-modal-title">{dashboardModal === "alerts" ? "Alerts needing review" : "Upcoming appointments"}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setDashboardModal(null)} aria-label="Close dashboard dialog">
                <X size={18} />
              </button>
            </div>
            <div className="dashboard-modal-scroll">
              {dashboardModal === "alerts" ? (
                activeAlerts.map((alert) => {
                  const patient = patients.find((item) => item.id === alert.patientId);
                  return (
                    <div className="list-card" key={alert.id}>
                      <div className="section-title">
                        <strong>{alert.title}</strong>
                        <SeverityBadge severity={alert.severity} />
                      </div>
                      <p>{patient?.name}: {alert.message}</p>
                      <button className="link-button" type="button" onClick={() => openPatientFromModal(alert.patientId)}>
                        View patient
                      </button>
                    </div>
                  );
                })
              ) : (
                scheduledAppointments.map((appointment) => {
                  const patient = patients.find((item) => item.id === appointment.patientId);
                  return (
                    <div className="list-card" key={appointment.id}>
                      <strong>{patient?.name || appointment.patientId}</strong>
                      <p>{appointment.date} at {appointment.time} · {appointment.type}</p>
                      <button className="link-button" type="button" onClick={() => openPatientFromModal(appointment.patientId)}>
                        View patient
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}

function AssignmentForm({
  patientId,
  onCreate
}: {
  patientId: string;
  onCreate: (assignment: Omit<Assignment, "id" | "createdAt" | "updatedAt" | "status">) => Promise<void>;
}) {
  const [gameId, setGameId] = useState("ball-pickup");
  const defaults = gameDefaults[gameId];
  const game = strongestGames.find((item) => item.id === gameId) || strongestGames[0];
  const [difficulty, setDifficulty] = useState<Assignment["difficulty"]>("medium");
  const [frequency, setFrequency] = useState("daily");
  const [dueDate, setDueDate] = useState(futureDate(7));
  const [targetSkill, setTargetSkill] = useState(defaults.targetSkill);
  const [reps, setReps] = useState(defaults.reps || 0);
  const [rounds, setRounds] = useState(defaults.rounds || 0);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextDefaults = gameDefaults[gameId];
    setTargetSkill(nextDefaults.targetSkill);
    setReps(nextDefaults.reps || 0);
    setRounds(nextDefaults.rounds || 0);
  }, [gameId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!gameId || !dueDate) {
      setMessage("Please select a game and due date.");
      return;
    }
	    setSaving(true);
	    try {
	      await onCreate({
	        patientId,
	        doctorId: demoDoctor.id,
	        gameId,
	        gameName: game.name,
	        difficulty,
	        reps: reps || null,
	        rounds: rounds || null,
	        frequency,
	        dueDate,
	        targetSkill,
	        notes
	      });
	      setMessage("Assignment saved.");
	    } catch {
	      setMessage("Unable to save assignment.");
	    } finally {
	      setSaving(false);
	    }
  };

  return (
    <form className="assignment-form" onSubmit={submit}>
      <div className="assignment-form-grid assignment-form-grid--primary">
        <label className="assignment-field assignment-field--wide">
          <span>Game</span>
          <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
            {strongestGames.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="assignment-field">
          <span>Difficulty</span>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Assignment["difficulty"])}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>
      <div className="assignment-form-grid">
        <label className="assignment-field">
          <span>Reps</span>
          <input type="number" min={0} value={reps} onChange={(event) => setReps(Number(event.target.value))} />
        </label>
        <label className="assignment-field">
          <span>Rounds</span>
          <input type="number" min={0} value={rounds} onChange={(event) => setRounds(Number(event.target.value))} />
        </label>
      </div>
      <div className="assignment-form-grid">
        <label className="assignment-field">
          <span>Frequency</span>
          <select value={frequency} onChange={(event) => setFrequency(event.target.value)}>
            <option value="daily">Daily</option>
            <option value="3x/week">3x/week</option>
            <option value="2x/week">2x/week</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className="assignment-field">
          <span>Due date</span>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
      </div>
      <label className="assignment-field">
        <span>Target skill</span>
        <input value={targetSkill} onChange={(event) => setTargetSkill(event.target.value)} />
      </label>
      <label className="assignment-field">
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Assignment notes" />
      </label>
	      {message && <InlineAlert tone={message.includes("Unable") || message.includes("Please") ? "warning" : "success"}>{message}</InlineAlert>}
	      <button className="primary-button assignment-submit" type="submit" disabled={saving}>
	        <Plus size={18} />
	        {saving ? "Saving assignment..." : "Assign exercise"}
	      </button>
    </form>
  );
}

function AppointmentForm({
  patientId,
  onCreate
}: {
  patientId: string;
  onCreate: (appointment: Omit<Appointment, "id" | "createdAt">) => Promise<void>;
}) {
  const [date, setDate] = useState(futureDate(7));
  const [time, setTime] = useState("10:00");
  const [type, setType] = useState("Progress check-in");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await onCreate({
        patientId,
        doctorId: demoDoctor.id,
        date,
        time,
        type,
        notes,
        status: "scheduled"
      });
      setNotes("");
      setMessage("Appointment scheduled.");
    } catch {
      setMessage("Unable to schedule appointment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="form-row">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Time
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <label>
        Type
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option>Progress check-in</option>
          <option>Initial assessment</option>
          <option>Follow-up</option>
          <option>Exercise review</option>
          <option>Pain/fatigue review</option>
        </select>
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {message && <InlineAlert tone={message.includes("Unable") ? "warning" : "success"}>{message}</InlineAlert>}
      <button className="primary-button" type="submit" disabled={saving}>
        <CalendarDays size={18} />
        {saving ? "Scheduling..." : "Schedule appointment"}
      </button>
    </form>
  );
}

function ProfilePage({
  patient,
  assignments,
  alerts,
  appointments,
  aiSummary,
  difficultyRecommendation,
  activeTab,
  onStartAssignment,
  onCreateAssignment,
  onRemoveAssignment,
  onCreateAppointment,
  onRegenerateSummary,
  onSaveNotes
}: {
  patient: Patient;
  assignments: Assignment[];
  alerts: Alert[];
  appointments: Appointment[];
  aiSummary?: AiProgressSummary | null;
  difficultyRecommendation?: DifficultyRecommendation | null;
  activeTab: PatientTab;
  onStartAssignment: (assignment: Assignment) => void;
  onCreateAssignment: (assignment: Omit<Assignment, "id" | "createdAt" | "updatedAt" | "status">) => Promise<void>;
  onRemoveAssignment: (assignmentId: string) => Promise<void>;
  onCreateAppointment: (appointment: Omit<Appointment, "id" | "createdAt">) => Promise<void>;
  onRegenerateSummary: () => Promise<void>;
  onSaveNotes: (notes: string) => Promise<void>;
}) {
  const summary = summarizePatient(patient);
  const latestSession = patient.sessions[0];
  const allEvents = patient.sessions.flatMap((session) => session.events);
  const [notes, setNotes] = useState(patient.notes || "");
  const [notesMessage, setNotesMessage] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);
  const patientAssignmentList = patientAssignments(patient.id, assignments);
  const patientAlertList = patientAlerts(patient.id, alerts);
  const accuracyTrend = getAccuracyTrend(patient.id, patient.sessions).map((item) => ({
    ...item,
    date: formatShortDate(item.date)
  }));
  const repsTrend = getRepsTrend(patient.id, patient.sessions);
  const painFatigueTrend = getPainFatigueTrend(patient.id, patient.sessions);
  const adherence = getWeeklyCompletionRate(patient.id, assignments, patient.sessions);
  const weakest = detectWeakestFinger(patient.sessions);
  const localRecommendation = getLocalDifficultyRecommendation(patient, assignments, patient.sessions);
  const recommendation = difficultyRecommendation || {
    patientId: patient.id,
    recommendation: localRecommendation.recommendation,
    reason: localRecommendation.reason,
    label: "Clinician must approve changes."
  };

  useEffect(() => {
    setNotes(patient.notes || "");
    setNotesMessage("");
  }, [patient.id, patient.notes]);

  const regenerateSummary = async () => {
    setSummaryError("");
    setSummaryLoading(true);
    try {
      await onRegenerateSummary();
    } catch {
      setSummaryError("Unable to generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const saveNotes = async () => {
    setNotesMessage("");
    try {
      await onSaveNotes(notes);
      setNotesMessage("Note saved.");
    } catch {
      setNotesMessage("Unable to save note.");
    }
  };

  return (
    <>
      {activeTab === "overview" && (
      <>
      <div className="metric-grid">
        <MetricCard label="Total sessions" value={summary.totalSessions} detail="recorded visits" icon={ClipboardList} />
        <MetricCard label="Adherence" value={`${adherence}%`} detail="current plan" icon={Activity} tone="teal" />
        <MetricCard label="Latest accuracy" value={`${getLatestAccuracy(patient.id, patient.sessions)}%`} detail="most recent session" icon={CircleDot} tone="amber" />
        <MetricCard label="Weakest finger" value={fingerLabels[weakest.weakestFinger]} detail={`${Math.round(weakest.confidence * 100)}% confidence`} icon={UserRound} tone="red" />
      </div>

      <div className="two-column">
        <article className="surface">
          <div className="section-title">
            <h3>Alerts</h3>
            <span>{patientAlertList.length} active</span>
          </div>
          <div className="stack-list">
	            {patientAlertList.length === 0 ? <EmptyState title="No alerts for this patient" description="No missed sessions, pain increases, or weak-finger alerts are currently unresolved." /> : patientAlertList.map((alert) => (
              <div className="list-card" key={alert.id}>
                <div className="section-title">
                  <strong>{alert.title}</strong>
                  <SeverityBadge severity={alert.severity} />
                </div>
                <p>{alert.message}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface">
          <div className="section-title">
            <h3>AI Progress Summary</h3>
	            <button className="secondary-button" type="button" onClick={regenerateSummary} disabled={summaryLoading}>
	              <Sparkles size={17} />
	              {summaryLoading ? "Generating..." : "Regenerate Summary"}
	            </button>
	          </div>
	          {summaryError && <InlineAlert tone="warning">{summaryError}</InlineAlert>}
	          <p>{summaryLoading ? "Generating summary..." : aiSummary?.summary || `${patient.name} has ${patient.sessions.length} recorded sessions. Clinician review recommended.`}</p>
	          <small className="clinical-note">For clinician review only. Treatment changes require approval.</small>
        </article>
      </div>

      <div className="two-column">
        <article className="surface">
          <div className="section-title">
            <h3>Difficulty Recommendation</h3>
            <span>Clinician approval required</span>
          </div>
          <div className="recommendation-card">
            <strong>{recommendation.recommendation}</strong>
            <p>{recommendation.reason}</p>
            <small>{recommendation.label}</small>
          </div>
        </article>
        <article className="surface chart-card">
          <div className="section-title">
            <h3>Accuracy over time</h3>
            <span>{getImprovementPercent(patient.id, patient.sessions)}% improvement</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={accuracyTrend} margin={{ top: 10, right: 20, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" />
              <YAxis domain={[0, 100]} stroke="#64748b" />
              <Tooltip />
              <Line type="monotone" dataKey="accuracy" stroke="#2563eb" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </div>
      </>
      )}

      {activeTab === "plan" && (
      <div className="care-plan-layout">
        <article className="care-plan-panel care-plan-current">
          <div className="care-plan-section-header">
            <div>
              <span className="eyebrow">Current Plan</span>
              <h3>Assigned rehab</h3>
            </div>
            <span>{patientAssignmentList.length} active</span>
          </div>
          <div className="plan-card-list">
	            {patientAssignmentList.length === 0 ? (
	              <div className="plan-empty-card">
	                <EmptyState title="No active assignments" description="Choose a rehab game to build this patient's plan." />
	              </div>
            ) : (
              patientAssignmentList.map((assignment) => (
                <div className="plan-assignment-card" key={assignment.id}>
                  <div className="plan-assignment-top">
                    <div>
                      <strong>{assignment.gameName}</strong>
                      <p>{assignment.targetSkill}</p>
                    </div>
                    <StatusBadge status={assignment.status} />
                  </div>
                  <div className="plan-assignment-meta">
                    <span>{assignment.difficulty}</span>
                    <span>{assignment.reps ? `${assignment.reps} reps` : `${assignment.rounds} rounds`}</span>
                    <span>{assignment.frequency}</span>
                    <span>Due {assignment.dueDate}</span>
                  </div>
                  {assignment.notes && <p>{assignment.notes}</p>}
                  <div className="plan-assignment-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={removingAssignmentId === assignment.id}
                      onClick={() => onStartAssignment(assignment)}
                    >
                      <Play size={17} />
                      Start this assignment
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={removingAssignmentId === assignment.id}
                      onClick={async () => {
                        if (!window.confirm(`Remove "${assignment.gameName}" from this patient's plan?`)) return;
                        setRemovingAssignmentId(assignment.id);
                        try {
                          await onRemoveAssignment(assignment.id);
                        } finally {
                          setRemovingAssignmentId(null);
                        }
                      }}
                    >
                      <Trash2 size={17} />
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="care-plan-panel care-plan-assign">
          <div className="care-plan-section-header">
            <div>
              <span className="eyebrow">Assign Exercise</span>
              <h3>New rehab game</h3>
            </div>
            <Plus size={18} />
          </div>
          <AssignmentForm patientId={patient.id} onCreate={onCreateAssignment} />
        </article>
      </div>
      )}

      {activeTab === "sessions" && (
      <>
      <article className="surface">
        <div className="section-title">
          <h3>Recent sessions</h3>
          <span>{latestSession ? `Latest ${formatDate(latestSession.startedAt)}` : "No sessions"}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Game</th>
                <th>Input</th>
                <th>Reps</th>
                <th>Accuracy</th>
                <th>Score</th>
                <th>Pain</th>
                <th>Fatigue</th>
                <th>Weakest</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
	              {patient.sessions.length === 0 ? (
	                <tr>
	                  <td colSpan={10}>No sessions recorded yet.</td>
	                </tr>
	              ) : patient.sessions.map((session) => (
                <tr key={session.id}>
                  <td>{formatShortDate(session.startedAt)}</td>
                  <td>{session.gameName || session.exerciseName}</td>
                  <td>{session.inputMode || "demo"}</td>
                  <td>
                    {session.repsCompleted}/{session.repsRequired || session.targetReps}
                  </td>
                  <td>{session.accuracy ?? session.averageAccuracy}%</td>
                  <td>{session.score ?? session.bestFistScore}</td>
                  <td>{session.painBefore ?? 0} → {session.painAfter ?? 0}</td>
                  <td>{session.fatigueBefore ?? 0} → {session.fatigueAfter ?? 0}</td>
                  <td>{session.weakestFinger ? fingerLabels[session.weakestFinger] : fingerLabels[summary.weakestFinger]}</td>
                  <td>{session.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="chart-grid">
        <article className="surface chart-card">
          <div className="section-title">
            <h3>Accuracy over time</h3>
            <span>{getImprovementPercent(patient.id, patient.sessions)}% improvement</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={accuracyTrend} margin={{ top: 10, right: 20, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" />
              <YAxis domain={[0, 100]} stroke="#64748b" />
              <Tooltip />
              <Line type="monotone" dataKey="accuracy" stroke="#2563eb" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </article>
        <article className="surface chart-card">
          <div className="section-title">
            <h3>Reps trend</h3>
            <span>completed reps</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={repsTrend} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Bar dataKey="repsCompleted" fill="#0f766e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="two-column">
        <article className="surface">
          <div className="section-title">
            <h3>Pain and fatigue trend</h3>
            <span>latest first</span>
          </div>
          <div className="stack-list">
            {painFatigueTrend.slice(-4).reverse().map((item) => (
              <div className="list-card compact-list-card" key={item.date}>
                <strong>{item.date}</strong>
                <p>Pain {item.painBefore} → {item.painAfter} · Fatigue {item.fatigueBefore} → {item.fatigueAfter}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
      </>
      )}

      {activeTab === "appointments" && (
      <div className="two-column">
        <article className="surface">
          <div className="section-title">
            <h3>Appointments</h3>
            <CalendarDays size={18} />
          </div>
	          <div className="stack-list">
	            {appointments.filter((appointment) => appointment.patientId === patient.id).length === 0 ? (
	              <EmptyState title="No appointments scheduled" description="Schedule a follow-up or review from this workspace." />
	            ) : appointments.filter((appointment) => appointment.patientId === patient.id).map((appointment) => (
	              <div className="list-card" key={appointment.id}>
                <div className="section-title">
                  <strong>{appointment.type}</strong>
                  <StatusBadge status={appointment.status} />
                </div>
                <p>{appointment.date} at {appointment.time}</p>
                {appointment.notes && <p>{appointment.notes}</p>}
              </div>
            ))}
          </div>
	          <AppointmentForm patientId={patient.id} onCreate={onCreateAppointment} />
	        </article>
	      </div>
	      )}

	      {activeTab === "notes" && (
	      <div className="two-column">
	        <article className="surface">
	          <div className="section-title">
	            <h3>Doctor notes</h3>
	            <Save size={18} />
	          </div>
	          {!patient.notes && <EmptyState title="No notes yet" description="Capture clinician context and session observations for this patient." />}
	          <label>
	            Notes
	            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Focus on fully opening hand before releasing objects." />
	          </label>
	          {notesMessage && <InlineAlert tone={notesMessage.includes("Unable") ? "warning" : "success"}>{notesMessage}</InlineAlert>}
	          <button className="primary-button" type="button" onClick={saveNotes}>
	            <Save size={18} />
	            Save note
	          </button>
	        </article>

	        <article className="surface">
	          <div className="section-title">
	            <h3>Patient context</h3>
	            <span>For note-taking</span>
	          </div>
	          <div className="stack-list">
	            <div className="list-card">
	              <strong>Latest accuracy</strong>
	              <p>{getLatestAccuracy(patient.id, patient.sessions)}% in the most recent saved session.</p>
	            </div>
	            <div className="list-card">
	              <strong>Weakest finger</strong>
	              <p>{fingerLabels[weakest.weakestFinger]} finger weakness detected across recent sessions.</p>
	            </div>
	            <div className="list-card">
	              <strong>Current plan</strong>
	              <p>{patientAssignmentList.length} assignment{patientAssignmentList.length === 1 ? "" : "s"} active or recently assigned.</p>
	            </div>
	          </div>
	        </article>
	      </div>
	      )}
	    </>
  );
}

function LiveSessionPage({
  patient,
  currentEvent,
  simulatorEnabled,
  setSimulatorEnabled,
  activeSession,
  onStart,
  onEnd,
  onFakeGesture,
  onNotesChange
}: {
  patient: Patient;
  currentEvent: GestureEvent;
  simulatorEnabled: boolean;
  setSimulatorEnabled: (value: boolean) => void;
  activeSession: SessionDraft | null;
  onStart: (exercise: ExerciseTemplate) => void;
  onEnd: () => void;
  onFakeGesture: () => void;
  onNotesChange: (notes: string) => void;
}) {
  const [selectedExerciseId, setSelectedExerciseId] = useState(exerciseTemplates[0].id);
  const selectedExercise =
    exerciseTemplates.find((exercise) => exercise.id === selectedExerciseId) ?? exerciseTemplates[0];

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Live gesture stream</span>
          <h2>{patient.name}</h2>
        </div>
        <div className="toolbar">
          <button
            className={`toggle-button ${simulatorEnabled ? "is-on" : ""}`}
            onClick={() => setSimulatorEnabled(!simulatorEnabled)}
          >
            {simulatorEnabled ? <Pause size={17} /> : <Play size={17} />}
            Fake glove
          </button>
          <button className="secondary-button" type="button" onClick={onFakeGesture}>
            <Activity size={17} />
            Generate Fake Gesture
          </button>
          {activeSession ? (
            <button className="danger-button" onClick={onEnd}>
              <Save size={18} />
              End and save
            </button>
          ) : (
            <button className="primary-button" onClick={() => onStart(selectedExercise)}>
              <Play size={18} />
              Start session
            </button>
          )}
        </div>
      </div>

      <div className="live-grid">
        <article className="current-gesture">
          <div className="section-title">
            <h3>Current gesture</h3>
            <GestureBadge gesture={currentEvent.gesture} />
          </div>
          <strong className="gesture-name">{gestureLabels[currentEvent.gesture]}</strong>
          <p>Accuracy {currentEvent.accuracy}% · Smoothness {currentEvent.smoothness}% · Hold {currentEvent.holdMs} ms</p>
          <FingerBars event={currentEvent} />
        </article>

        <aside className="session-panel">
          <label>
            Exercise
            <select
              value={selectedExerciseId}
              onChange={(event) => setSelectedExerciseId(event.target.value)}
              disabled={Boolean(activeSession)}
            >
              {exerciseTemplates.map((exercise) => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name}
                </option>
              ))}
            </select>
          </label>
          <div className="session-counter">
            <Timer size={22} />
            <div>
              <strong>{formatElapsed(activeSession?.startedAt)}</strong>
              <span>{activeSession ? "session timer" : "not recording"}</span>
            </div>
          </div>
          <div className="rep-box">
            <strong>{activeSession?.repsCompleted ?? 0}</strong>
            <span>reps completed</span>
          </div>
          <label>
            Therapist notes
            <textarea
              value={activeSession?.notes ?? ""}
              onChange={(event) => onNotesChange(event.target.value)}
              disabled={!activeSession}
              placeholder="Add session observations"
            />
          </label>
        </aside>
      </div>

      <article className="surface">
        <div className="section-title">
          <h3>Recent events</h3>
          <span>{activeSession?.events.length ?? 0} captured this session</span>
        </div>
        <div className="event-strip">
          {(activeSession?.events ?? [currentEvent]).slice(0, 12).map((event) => (
            <div className="event-chip" key={event.id}>
              <GestureBadge gesture={event.gesture} />
              <span>{formatDate(event.timestamp)}</span>
              <strong>{event.accuracy}%</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function ClinicAppointmentsPage({
  patients,
  appointments,
  onSelectPatient
}: {
  patients: Patient[];
  appointments: Appointment[];
  onSelectPatient: (id: string) => void;
}) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Clinic schedule</span>
          <h2>Appointments</h2>
          <p>Upcoming rehab reviews and follow-ups across the active patient roster.</p>
        </div>
      </div>
      <article className="surface">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Date</th>
                <th>Time</th>
                <th>Type</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appointment) => {
                const patient = patients.find((item) => item.id === appointment.patientId);
                return (
                  <tr key={appointment.id}>
                    <td>
                      <button className="link-button" type="button" onClick={() => onSelectPatient(appointment.patientId)}>
                        {patient?.name || appointment.patientId}
                      </button>
                    </td>
                    <td>{appointment.date}</td>
                    <td>{appointment.time}</td>
                    <td>{appointment.type}</td>
                    <td><StatusBadge status={appointment.status} /></td>
                    <td>{appointment.notes || "No notes"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function PatientsRosterPage({
  patients,
  assignments,
  alerts,
  loading = false,
  onSelectPatient
}: {
  patients: Patient[];
  assignments: Assignment[];
  alerts: Alert[];
  loading?: boolean;
  onSelectPatient: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = patients.filter((patient) =>
    `${patient.name} ${patient.condition || patient.diagnosis} ${patient.recoveryGoal || patient.goal}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <section className="page-stack patient-roster-page">
      <div className="page-heading patient-roster-heading">
        <div>
          <span className="eyebrow">Patient roster</span>
          <h2>Patients</h2>
          <p>Open a patient workspace to review progress, assignments, live monitoring, appointments, and notes.</p>
        </div>
        <label className="search-box patient-roster-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patients" />
        </label>
      </div>
      <div className="patient-roster-meta" aria-label="Patient roster summary">
        <span>{filtered.length} shown</span>
        <span>{patients.length} total</span>
        {loading ? <span>Updating...</span> : null}
      </div>
      <div className="patient-roster-grid">
        {filtered.map((patient) => {
          const weakest = detectWeakestFinger(patient.sessions);
          const adherence = getWeeklyCompletionRate(patient.id, assignments, patient.sessions);
          const alertsForPatient = patientAlerts(patient.id, alerts);
          const latestAccuracy = getLatestAccuracy(patient.id, patient.sessions);
          const activeAssignments = patientAssignments(patient.id, assignments).length;
          const sessionsThisWeek = patientSessionsThisWeek(patient);
          return (
            <article className="patient-roster-card" key={patient.id}>
              <header className="patient-roster-card-head">
                <div className="patient-roster-identity">
                  <div className="avatar patient-roster-avatar">{patient.name.slice(0, 1)}</div>
                  <div>
                    <span>{patient.condition || patient.diagnosis}</span>
                    <h3>{patient.name}</h3>
                  </div>
                </div>
                <StatusBadge status={patient.status} />
              </header>

              <p className="patient-roster-goal">{patient.recoveryGoal || patient.goal}</p>

              <div className="patient-roster-metrics">
                <div>
                  <span>Adherence</span>
                  <strong>{adherence}%</strong>
                </div>
                <div>
                  <span>Accuracy</span>
                  <strong>{latestAccuracy}%</strong>
                </div>
                <div>
                  <span>Weakest</span>
                  <strong>{fingerLabels[weakest.weakestFinger]}</strong>
                </div>
                <div>
                  <span>Alerts</span>
                  <strong>{alertsForPatient.length}</strong>
                </div>
              </div>

              <div className="patient-roster-footer">
                <div className="patient-roster-footnotes">
                  <span>{sessionsThisWeek} sessions this week</span>
                  <span>{activeAssignments} assigned games</span>
                </div>
                <button className="primary-button patient-roster-action" type="button" onClick={() => onSelectPatient(patient.id)}>
                  <UserRound size={17} />
                  View patient
                </button>
              </div>
            </article>
          );
        })}
        {loading && filtered.length === 0 && (
          <>
            {[0, 1, 2].map((i) => (
              <article className="patient-roster-card patient-roster-card--loading" key={i} aria-hidden>
                <header className="patient-roster-card-head">
                  <div className="patient-roster-identity">
                    <div className="avatar patient-roster-avatar" />
                    <div>
                      <span />
                      <h3 />
                    </div>
                  </div>
                </header>
                <p className="patient-roster-goal" />
                <div className="patient-roster-metrics">
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item}>
                      <span />
                      <strong />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </>
        )}
      </div>
      {!loading && filtered.length === 0 && <EmptyState title="No patients found" description="Try a different name, condition, or goal." />}
    </section>
  );
}

function GloveDevPage({ patientId }: { patientId: string }) {
  const glove = useGloveData(patientId, { hardwareOnly: true });
  const fingers = ["thumb", "index", "middle", "ring", "pinky"] as const;
  const [calOpen, setCalOpen] = useState<FingerBends | null>(null);
  const [calClosed, setCalClosed] = useState<FingerBends | null>(null);
  const [calSaved, setCalSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingCalibration, setLoadingCalibration] = useState(true);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === previewFrameRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCalibrationState() {
      setLoadingCalibration(true);
      try {
        const calibration = await fetchCalibration(patientId);
        if (cancelled) return;
        setCalOpen(calibration.open);
        setCalClosed(calibration.closed);
        setCalSaved(true);
      } catch {
        if (cancelled) return;
        setCalOpen(null);
        setCalClosed(null);
        setCalSaved(false);
      } finally {
        if (!cancelled) setLoadingCalibration(false);
      }
    }

    loadCalibrationState();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const calibrationReady = !!(calOpen && calClosed && calSaved);

  const liveCalibratedBends = useMemo(() => {
    if (!calOpen || !calClosed || !glove.rawValues) return null;
    return calibratedBendsFromRaw(glove.rawValues, calOpen, calClosed);
  }, [calClosed, calOpen, glove.rawValues]);

  const status = loadingCalibration
    ? { label: "Loading", background: "#e0f2fe", color: "#0f766e" }
    : calSaved
      ? { label: "Calibration saved", background: "#dcfce7", color: "#166534" }
      : calOpen && calClosed
        ? { label: "Unsaved", background: "#fef3c7", color: "#92400e" }
        : { label: "Not calibrated", background: "#e2e8f0", color: "#475569" };

  async function handleSaveCalibration() {
    if (!calOpen || !calClosed) return;
    setSaving(true);
    try {
      const calibration = await saveCalibration(patientId, {
        open: calOpen,
        closed: calClosed
      });
      setCalOpen(calibration.open);
      setCalClosed(calibration.closed);
      setCalSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function captureRawValues(values: Record<string, number> | null): FingerBends | null {
    if (!values) return null;
    return {
      thumb: values.thumb ?? 0,
      index: values.index ?? 0,
      middle: values.middle ?? 0,
      ring: values.ring ?? 0,
      pinky: values.pinky ?? 0
    };
  }

  function renderCalibrationTable(title: string, values: FingerBends | null) {
    if (!values) return null;

    return (
      <div className="surface" style={{ padding: "1rem", minWidth: 220, flex: 1 }}>
        <div className="section-title" style={{ marginBottom: "0.75rem" }}>
          <h3>{title}</h3>
        </div>
        <div style={{ display: "grid", gap: "0.45rem" }}>
          {fingers.map((finger) => (
            <div
              key={finger}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr",
                gap: "0.5rem",
                fontSize: "0.82rem",
                alignItems: "center"
              }}
            >
              <span style={{ textTransform: "capitalize", color: "var(--text-muted, #64748b)" }}>{finger}</span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{values[finger]}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  async function togglePreviewFullscreen() {
    const node = previewFrameRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen();
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Developer tools</span>
          <h2>Glove Dev Monitor</h2>
          <p>Capture a relaxed open hand and a full fist from live hardware frames, save calibration, then inspect calibrated movement in the hand preview.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="surface" style={{ padding: "1.25rem", minWidth: 320, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: glove.connected ? "#22c55e" : "#ef4444"
              }}
            />
            <strong style={{ fontSize: "0.9rem" }}>
              {glove.connected ? "Hardware glove connected" : "Waiting for raw glove frames"}
            </strong>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "0.75rem",
                padding: "0.2rem 0.55rem",
                borderRadius: 999,
                background: status.background,
                color: status.color,
                fontWeight: 600
              }}
            >
              {status.label}
            </span>
            {glove.lastUpdated && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>
                {new Date(glove.lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "92px minmax(0, 1fr) 96px",
              gap: "0.65rem 0.75rem",
              alignItems: "center"
            }}
          >
            <strong style={{ fontSize: "0.78rem", color: "var(--text-muted, #64748b)" }}>Finger</strong>
            <strong style={{ fontSize: "0.78rem", color: "var(--text-muted, #64748b)" }}>Raw ADC</strong>
            <strong style={{ fontSize: "0.78rem", color: "var(--text-muted, #64748b)", textAlign: "right" }}>Calibrated</strong>
            {fingers.map((finger) => {
              const rawValue = glove.rawValues?.[finger] ?? null;
              const calibratedValue = calibrationReady ? liveCalibratedBends?.[finger] ?? null : null;
              return (
                <Fragment key={finger}>
                  <span style={{ fontSize: "0.82rem", textTransform: "capitalize", fontWeight: 500 }}>{finger}</span>
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontVariantNumeric: "tabular-nums",
                      color: rawValue === null ? "var(--text-muted, #64748b)" : "inherit"
                    }}
                  >
                    {rawValue ?? "—"}
                  </span>
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontVariantNumeric: "tabular-nums",
                      textAlign: "right",
                      color: calibratedValue === null ? "var(--text-muted, #64748b)" : "inherit"
                    }}
                  >
                    {calibratedValue !== null ? `${calibratedValue}%` : "Locked"}
                  </span>
                </Fragment>
              );
            })}
          </div>

          <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border, #e2e8f0)", display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
            <span style={{ color: "var(--text-muted, #64748b)" }}>Gesture</span>
            <strong>{calibrationReady ? glove.gesture : "Locked until calibrated"}</strong>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <button
              type="button"
              className="secondary-button"
              disabled={!glove.rawValues}
              onClick={() => {
                setCalOpen(captureRawValues(glove.rawValues));
                setCalSaved(false);
              }}
            >
              Capture OPEN
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!glove.rawValues}
              onClick={() => {
                setCalClosed(captureRawValues(glove.rawValues));
                setCalSaved(false);
              }}
            >
              Capture FIST
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!calOpen || !calClosed || saving}
              onClick={handleSaveCalibration}
            >
              {saving ? "Saving..." : "Save Calibration"}
            </button>
          </div>

          {liveCalibratedBends && (
            <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border, #e2e8f0)", fontSize: "0.82rem" }}>
              <strong>Preview:</strong>{" "}
              {fingers.map((finger) => `${finger[0].toUpperCase()}:${liveCalibratedBends[finger]}%`).join(" ")}
            </div>
          )}

          {!glove.rawValues && (
            <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--text-muted, #64748b)" }}>
              This screen ignores simulator traffic and waits for raw ESP32 frames only. Keep the bridge running and confirm it is posting `rawValues`.
            </p>
          )}
        </div>

        <div className="surface" style={{ padding: "1.25rem", flex: 1, minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <p style={{ fontSize: "0.82rem", margin: 0, color: "var(--text-muted, #64748b)" }}>Calibrated Hand Preview</p>
            <button type="button" className="secondary-button" onClick={togglePreviewFullscreen}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
          {calibrationReady && liveCalibratedBends ? (
            <div ref={previewFrameRef}>
              <Canvas
                style={{ height: fullscreen ? "80vh" : 320, width: "100%", borderRadius: 10, background: "radial-gradient(circle at top, #1f2a44 0%, #111827 72%)" }}
                camera={{ position: [0, 0.12, 4.5], fov: 20 }}
              >
                <ambientLight intensity={0.8} />
                <directionalLight position={[2.4, 3.8, 2.8]} intensity={1.8} />
                <directionalLight position={[-2, 1.8, 1]} intensity={0.8} color="#c7d2fe" />
                <HandModel3D bends={liveCalibratedBends} />
              </Canvas>
            </div>
          ) : (
            <div
              style={{
                height: 320,
                borderRadius: 10,
                background: "linear-gradient(160deg, #162033 0%, #0f172a 100%)",
                display: "grid",
                placeItems: "center",
                padding: "1.5rem",
                textAlign: "center"
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "#e2e8f0" }}>3D hand unlocks after calibration</p>
                <p style={{ margin: "0.55rem 0 0", fontSize: "0.82rem", color: "#94a3b8", maxWidth: 320 }}>
                  Capture OPEN and FIST with the live glove, save the calibration, and the preview will switch to the calibrated sensor bends immediately.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {(calOpen || calClosed) && (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {renderCalibrationTable("Captured OPEN", calOpen)}
          {renderCalibrationTable("Captured FIST", calClosed)}
        </div>
      )}

      <div className="surface" style={{ padding: "1rem", fontSize: "0.8rem" }}>
        <strong>Setup</strong>
        <ol style={{ marginTop: "0.4rem", paddingLeft: "1.2rem", lineHeight: 1.9 }}>
          <li>Flash <code>esp32/glove.ino</code> to the ESP32</li>
          <li>Copy <code>bridge/.env.example</code> → <code>bridge/.env</code> and set <code>SERIAL_PORT</code></li>
          <li>Run <code>cd bridge && node bridge.js</code></li>
          <li>Capture OPEN, capture FIST, save calibration, then verify the live 3D hand</li>
        </ol>
      </div>

      <HandMovementSection />
    </section>
  );
}

function AppShell({
  children,
  view,
  setView,
  patient,
  onLogout,
  currentEvent,
  backendConnected,
  simulatorEnabled
	}: {
	  children: React.ReactNode;
	  view: ViewName;
  setView: (view: ViewName) => void;
  patient: Patient;
	  onLogout: () => void;
	  currentEvent: GestureEvent;
  backendConnected: boolean;
  simulatorEnabled: boolean;
	}) {
	  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
    const [settingsDialog, setSettingsDialog] = useState<"accounts" | "system-status" | null>(null);
	  const settingsMenuRef = useRef<HTMLDivElement>(null);
	  const topbarTitle =
	    view === "patient"
	      ? patient.name
	      : rehabGameViews.includes(view)
	        ? demoDoctor.name
	        : view === "appointments"
	          ? "Appointments"
	          : view === "patients"
	            ? "Patients"
	            : "Doctor Dashboard";
	  const topbarSubtitle =
	    view === "patient"
	      ? `${patient.condition || patient.diagnosis} · ${patient.affectedHand || "right"} hand · ${String(patient.status).replace(/_/g, " ")}`
	      : rehabGameViews.includes(view)
	        ? demoDoctor.specialty
	        : `${demoDoctor.name} · Rehab workspace`;

    useEffect(() => {
      if (!settingsMenuOpen) return;

      function closeOnOutsideClick(event: MouseEvent) {
        if (settingsMenuRef.current?.contains(event.target as Node)) return;
        setSettingsMenuOpen(false);
      }

      function closeOnEscape(event: KeyboardEvent) {
        if (event.key === "Escape") setSettingsMenuOpen(false);
      }

      document.addEventListener("mousedown", closeOnOutsideClick);
      document.addEventListener("keydown", closeOnEscape);
      return () => {
        document.removeEventListener("mousedown", closeOnOutsideClick);
        document.removeEventListener("keydown", closeOnEscape);
      };
    }, [settingsMenuOpen]);

    useEffect(() => {
      if (!settingsDialog) return;

      function closeOnEscape(event: KeyboardEvent) {
        if (event.key === "Escape") setSettingsDialog(null);
      }

      document.addEventListener("keydown", closeOnEscape);
      return () => document.removeEventListener("keydown", closeOnEscape);
    }, [settingsDialog]);

    const openSettingsDialog = (dialog: "accounts" | "system-status") => {
      setSettingsDialog(dialog);
      setSettingsMenuOpen(false);
    };

	  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">
            <Activity size={21} />
          </div>
          <div>
            <strong>Dextera</strong>
            <span>Doctor dashboard</span>
          </div>
        </div>
        <nav>
          {viewItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={sideNavActive(item.id, view) ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
	        <header className="topbar">
	          <div>
	            <span className="eyebrow">
	              {view === "patient" ? "Selected patient" : rehabGameViews.includes(view) ? "Rehab Games library" : "Clinic workspace"}
	            </span>
	            <strong>{topbarTitle}</strong>
	            <p>{topbarSubtitle}</p>
	          </div>
	          <div className="topbar-actions">
	            {view === "patient" || rehabGameViews.includes(view) ? <GestureBadge gesture={currentEvent.gesture} /> : null}
            <div className="settings-menu" ref={settingsMenuRef}>
              <button
                className="icon-button settings-menu-trigger"
                type="button"
                onClick={() => setSettingsMenuOpen((open) => !open)}
                title="Settings"
                aria-haspopup="menu"
                aria-expanded={settingsMenuOpen}
              >
                <Settings size={18} />
              </button>
              {settingsMenuOpen ? (
                <div className="settings-dropdown" role="menu" aria-label="Settings menu">
                  <button type="button" role="menuitem" className="settings-dropdown-danger" onClick={onLogout}>
                    <LogOut size={17} />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        {children}
      </main>
      {settingsDialog ? (
        <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
          <button className="settings-modal-backdrop" type="button" aria-label="Close settings dialog" onClick={() => setSettingsDialog(null)} />
          <article className="settings-modal-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">Settings</span>
                <h3 id="settings-modal-title">{settingsDialog === "accounts" ? "Accounts" : "System status"}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsDialog(null)} aria-label="Close settings dialog">
                X
              </button>
            </div>
            {settingsDialog === "accounts" ? (
              <div className="stack-list">
                <div className="list-card"><strong>Doctor</strong><p>{productionDoctorAccount.email} · {productionDoctorAccount.password}</p></div>
                <div className="list-card"><strong>Patients</strong><p>Patients create their own accounts from the patient sign-in page.</p></div>
              </div>
            ) : (
              <div className="stack-list">
                <div className="list-card">
                  <strong>Backend</strong>
                  <p>{backendConnected ? "Backend connected." : "Demo data active."}</p>
                </div>
                <div className="list-card">
                  <strong>Simulator</strong>
                  <p>{simulatorEnabled ? "Demo simulator active. Live gesture events are generated automatically." : "Simulator paused. Manual fake gesture generation still works in live monitor."}</p>
                </div>
                <div className="list-card">
                  <strong>Hardware fallback</strong>
                  <p>The dashboard, patient portal, assignments, appointments, and summaries work without glove or camera input.</p>
                </div>
              </div>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const initialRoute = parseAppRoute(window.location.pathname);
  const [entryScreen, setEntryScreen] = useState<EntryScreen>(initialRoute.kind === "landing" ? "landing" : "login");
  const [authRole, setAuthRole] = useState<AuthRole>(
    initialRoute.kind === "sign-in" ? initialRoute.role : initialRoute.kind === "patient" ? "patient" : "doctor"
  );
  const [loggedIn, setLoggedIn] = useState(initialRoute.kind === "doctor" || initialRoute.kind === "patient");
  const productionAuth = Boolean(supabase);
  const [patients, setPatients] = useState<Patient[]>(
    initialRoute.kind === "patient"
      ? [{
          id: "patient-loading",
          userId: "patient-loading",
          doctorId: "doctor-1",
          name: "Patient",
          age: 0,
          diagnosis: "Hand rehabilitation program",
          condition: "Hand rehabilitation program",
          therapist: demoDoctor.name,
          status: "active",
          goal: "Complete assigned hand therapy sessions",
          recoveryGoal: "Complete assigned hand therapy sessions",
          affectedHand: "right",
          notes: "",
          baselineMobility: 40,
          sessions: []
        }]
      : []
  );
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [aiSummaries, setAiSummaries] = useState<Record<string, AiProgressSummary>>({});
  const [difficultyRecommendations, setDifficultyRecommendations] = useState<Record<string, DifficultyRecommendation>>({});
  const [exerciseAssignments, setExerciseAssignments] = useState<ExerciseAssignment[]>(() => readLocalExerciseAssignments());
  const [exerciseAssignmentError, setExerciseAssignmentError] = useState("");
  const [busyExerciseKeys, setBusyExerciseKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setLoggedIn(true);
        syncTherapistProfile();
      } else if (event === "SIGNED_OUT") {
        setLoggedIn(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    try {
      localStorage.removeItem("dextera.theme");
    } catch {
      // Ignore storage failures; the visual theme still applies for this session.
    }
  }, []);

  useEffect(() => {
    writeLocalExerciseAssignments(exerciseAssignments);
  }, [exerciseAssignments]);


  const [selectedPatientId, setSelectedPatientId] = useState(
    initialRoute.kind === "doctor" && initialRoute.patientId ? initialRoute.patientId : ""
  );
  const [view, setView] = useState<ViewName>(initialRoute.kind === "doctor" ? initialRoute.view : "dashboard");
  const [patientTab, setPatientTab] = useState<PatientTab>(
    initialRoute.kind === "doctor" && initialRoute.patientTab ? initialRoute.patientTab : "overview"
  );
  const [patientScreen, setPatientScreen] = useState<PatientScreen>(
    initialRoute.kind === "patient" ? initialRoute.screen : "home"
  );
  const [patientExerciseRoute, setPatientExerciseRoute] = useState<{
    assignmentId: string;
    step: PatientExerciseRouteStep;
  } | null>(
    initialRoute.kind === "patient" && initialRoute.exerciseAssignmentId
      ? { assignmentId: initialRoute.exerciseAssignmentId, step: initialRoute.exerciseStep ?? "detail" }
      : null
  );

  const [currentEvent, setCurrentEvent] = useState<GestureEvent>(() =>
    createGestureEvent("patient-loading", "open")
  );
  const [simulatorEnabled, setSimulatorEnabled] = useState(true);
  const [backendConnected, setBackendConnected] = useState(false);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionDraft | null>(null);
  const activeSessionRef = useRef<SessionDraft | null>(null);
  const previousGestureRef = useRef<GestureName>("open");
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const navigateTo = useCallback((path: string, replace = false) => {
    const nextPath = normalizePathname(path);
    if (normalizePathname(window.location.pathname) === nextPath) return;
    if (replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }
  }, []);

  const applyRoute = useCallback((route: AppRoute) => {
    if (route.kind === "landing") {
      setLoggedIn(false);
      setEntryScreen("landing");
      return;
    }
    if (route.kind === "sign-in") {
      setLoggedIn(false);
      setAuthRole(route.role);
      setEntryScreen("login");
      return;
    }
    setLoggedIn(true);
    setEntryScreen("login");
    if (route.kind === "patient") {
      setAuthRole("patient");
      setPatientScreen(route.screen);
      setPatientExerciseRoute(
        route.exerciseAssignmentId ? { assignmentId: route.exerciseAssignmentId, step: route.exerciseStep ?? "detail" } : null
      );
      return;
    }
    setAuthRole("doctor");
    setView(route.view);
    if (route.patientId) setSelectedPatientId(route.patientId);
    if (route.patientTab) setPatientTab(route.patientTab);
  }, []);

  useEffect(() => {
    const onPopState = () => applyRoute(parseAppRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRoute]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? patients[0],
    [patients, selectedPatientId]
  );

  useEffect(() => {
    if (!patients.length) return;
    setSelectedPatientId((current) =>
      patients.some((patient) => patient.id === current) ? current : patients[0].id
    );
  }, [patients]);

  const clinicianAssignedGames = useMemo(
    () => selectedPatient ? doctorAssignmentsToPatientCare(patientAssignments(selectedPatient.id, assignments)) : [],
    [assignments, selectedPatient]
  );

  const clinicianAppointmentSchedule = useMemo(
    () =>
      selectedPatient
        ?
      appointments
        .filter((item) => item.patientId === selectedPatient.id)
        .map(doctorAppointmentToPatientCare)
        : [],
    [appointments, selectedPatient]
  );

  const clinicianAssignedExercises = useMemo(
    () =>
      selectedPatient
        ? exerciseAssignments.filter((assignment) => assignment.patientId === selectedPatient.id)
        : [],
    [authRole, exerciseAssignments, selectedPatient]
  );

  const doctorGameLibraryPatient = useMemo(() => createDoctorGameLibraryPatient(demoDoctor.name), []);

  const openDoctorView = useCallback(
    (nextView: ViewName) => {
      setView(nextView);
      navigateTo(pathForDoctorView(nextView, selectedPatientId, patientTab));
    },
    [navigateTo, patientTab, selectedPatientId]
  );

  const openPatientPortalScreen = useCallback(
    (screen: PatientScreen) => {
      setPatientScreen(screen);
      setPatientExerciseRoute(null);
      navigateTo(patientScreenPaths[screen]);
    },
    [navigateTo]
  );

  const openPatientExerciseRoute = useCallback(
    (assignmentId: string, step: PatientExerciseRouteStep) => {
      setPatientScreen("home");
      setPatientExerciseRoute({ assignmentId, step });
      navigateTo(pathForPatientExercise(assignmentId, step));
    },
    [navigateTo]
  );

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const captureGestureEvent = useCallback((event: GestureEvent) => {
    if (seenEventIdsRef.current.has(event.id)) return;
    seenEventIdsRef.current.add(event.id);
    if (seenEventIdsRef.current.size > 300) {
      seenEventIdsRef.current = new Set(Array.from(seenEventIdsRef.current).slice(-180));
    }

    const repCompleted = previousGestureRef.current === "fist" && event.gesture === "open";
    previousGestureRef.current = event.gesture;
    setCurrentEvent(event);
    setActiveSession((session) => {
      if (!session || session.patientId !== event.patientId) return session;
      return {
        ...session,
        events: [event, ...session.events].slice(0, 120),
        repsCompleted: session.repsCompleted + (repCompleted ? 1 : 0)
      };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendData() {
      if (authRole === "patient") return;
      if (productionAuth && (!loggedIn || authRole !== "doctor")) return;
      if (!cancelled) setPatientsLoading(true);
      try {
        await checkBackendHealth();
        if (productionAuth && supabase) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            if (!cancelled) setBackendConnected(false);
            return;
          }
        }
        const backendPatients = (await fetchBackendPatientSummaries()).filter((patient) => !isDemoPatient(patient));
        if (cancelled) return;

        setPatients(backendPatients);
        setSelectedPatientId((current) =>
          backendPatients.some((patient) => patient.id === current) ? current : backendPatients[0]?.id ?? ""
        );
        setBackendConnected(true);
        const realPatientIds = new Set(backendPatients.map((patient) => patient.id));
        const [backendAlerts, backendAppointments] = await Promise.all([
          fetchAlerts().catch(() => []),
          fetchAppointments().catch(() => [])
        ]);
        if (cancelled) return;
        setAlerts(backendAlerts.filter((alert) => realPatientIds.has(alert.patientId)));
        setAppointments(backendAppointments.filter((appointment) => realPatientIds.has(appointment.patientId)));
        const [assignmentLists, exerciseAssignmentLists] = await Promise.all([
          Promise.all(backendPatients.map((patient) => fetchAssignments(patient.id).catch(() => []))),
          Promise.all(backendPatients.map((patient) => fetchExerciseAssignments(patient.id).catch(() => null)))
        ]);
        if (cancelled) return;
        setAssignments(assignmentLists.flat());
        setExerciseAssignments((current) => {
          const loadedPatientIds = new Set<string>();
          const loadedAssignments: ExerciseAssignment[] = [];
          exerciseAssignmentLists.forEach((list, index) => {
            if (list === null) return;
            loadedPatientIds.add(backendPatients[index].id);
            loadedAssignments.push(...list);
          });
          return mergeExerciseAssignments(
            loadedAssignments,
            current.filter((assignment) => !loadedPatientIds.has(assignment.patientId))
          );
        });
        setPatientsLoading(false);

        void Promise.all(
          backendPatients.map((patient) => fetchBackendPatient(patient.id).catch(() => patient))
        ).then((hydratedPatients) => {
          if (!cancelled) setPatients(hydratedPatients);
        });
      } catch {
        if (!cancelled) {
          setBackendConnected(false);
        }
      } finally {
        if (!cancelled) setPatientsLoading(false);
      }
    }

    loadBackendData();

    return () => {
      cancelled = true;
    };
  }, [authRole, loggedIn, productionAuth]);

  useEffect(() => {
    if (!backendConnected || !selectedPatientId) return;
    return connectGestureStream(selectedPatientId, captureGestureEvent, setBackendConnected);
  }, [backendConnected, captureGestureEvent, selectedPatientId]);

  // Also subscribe to the bridge's default patient so real glove events always flow in
  useEffect(() => {
    if (!backendConnected || !selectedPatientId || selectedPatientId === "demo-patient-1") return;
    return connectGestureStream("demo-patient-1", captureGestureEvent);
  }, [backendConnected, captureGestureEvent, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient?.id) return;
    if (!aiSummaries[selectedPatient.id]) {
      handleRegenerateSummary(selectedPatient.id);
    }
    if (backendConnected && !difficultyRecommendations[selectedPatient.id]) {
      fetchDifficultyRecommendation(selectedPatient.id)
        .then((recommendation) =>
          setDifficultyRecommendations((items) => ({ ...items, [selectedPatient.id]: recommendation }))
        )
        .catch(() => undefined);
    }
  }, [backendConnected, selectedPatient?.id]);

  useEffect(() => {
    if (!simulatorEnabled) return;
    if (!selectedPatientId) return;
    const interval = window.setInterval(() => {
      async function captureNextEvent() {
        if (backendConnected) {
          try {
            captureGestureEvent(await requestFakeGesture(selectedPatientId));
            return;
          } catch {
            setBackendConnected(false);
          }
        }

        const next =
          Math.random() > 0.72
            ? createGestureEvent(selectedPatientId).gesture
            : nextGesture(previousGestureRef.current);
        const sessionId = activeSessionRef.current?.id;
        captureGestureEvent(createGestureEvent(selectedPatientId, next, sessionId));
      }

      captureNextEvent();
    }, 1200);

    return () => window.clearInterval(interval);
  }, [backendConnected, captureGestureEvent, selectedPatientId, simulatorEnabled]);

  const selectPatient = (id: string) => {
    setSelectedPatientId(id);
    setCurrentEvent(createGestureEvent(id, "open"));
    previousGestureRef.current = "open";
    setPatientTab("overview");
    setView("patient");
    navigateTo(pathForDoctorView("patient", id, "overview"));
  };

  const refreshPatientSideData = async (patientId: string) => {
    if (!backendConnected) return;
    const [nextAssignments, nextAppointments, nextAlerts, nextExerciseAssignments] = await Promise.all([
      fetchAssignments(patientId).catch(() => patientAssignments(patientId, assignments)),
      fetchAppointments(patientId).catch(() => appointments.filter((appointment) => appointment.patientId === patientId)),
      fetchAlerts(patientId).catch(() => patientAlerts(patientId, alerts)),
      fetchExerciseAssignments(patientId).catch(() =>
        exerciseAssignments.filter((assignment) => assignment.patientId === patientId)
      )
    ]);
    setAssignments((items) => [...items.filter((item) => item.patientId !== patientId), ...nextAssignments]);
    setAppointments((items) => [...items.filter((item) => item.patientId !== patientId), ...nextAppointments]);
    setAlerts((items) => [...items.filter((item) => item.patientId !== patientId), ...nextAlerts]);
    setExerciseAssignments((items) => [
      ...items.filter((assignment) => assignment.patientId !== patientId),
      ...nextExerciseAssignments
    ]);
  };

  const handleCreateAssignment = async (
    assignment: Omit<Assignment, "id" | "createdAt" | "updatedAt" | "status">
  ) => {
    if (backendConnected) {
      try {
        const created = await createAssignment(assignment);
        setAssignments((items) => [created, ...items]);
        return;
      } catch {
        setBackendConnected(false);
      }
    }
    setAssignments((items) => [
      {
        ...assignment,
        id: `assignment-${Date.now()}`,
        status: "assigned",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      ...items
    ]);
  };

  const handleRemoveAssignment = async (assignmentId: string, patientId: string) => {
    if (backendConnected) {
      try {
        await deleteAssignment(assignmentId);
        setAssignments((items) => items.filter((item) => item.id !== assignmentId));
        await refreshPatientSideData(patientId);
      } catch {
        setBackendConnected(false);
      }
      return;
    }
    setAssignments((items) => items.filter((item) => item.id !== assignmentId));
  };

  const handleAssignExercise = async (patientId: string, exerciseId: string) => {
    if (!patientId) return;
    const busyKey = `${patientId}:${exerciseId}`;
    setExerciseAssignmentError("");
    setBusyExerciseKeys((items) => Array.from(new Set([...items, busyKey])));
    const optimistic: ExerciseAssignment = {
      id: `exercise-assignment-${Date.now()}`,
      patientId,
      exerciseId,
      assignedAt: new Date().toISOString(),
      status: "assigned",
      completedAt: null,
      result: null
    };
    setExerciseAssignments((items) =>
      mergeExerciseAssignments([optimistic], items.filter((item) => item.patientId !== patientId || item.exerciseId !== exerciseId))
    );
    const mustPersistToBackend = productionAuth || backendConnected;
    if (mustPersistToBackend) {
      try {
        const created = await createExerciseAssignment({ patientId, exerciseId, assignedAt: optimistic.assignedAt });
        setExerciseAssignments((items) =>
          mergeExerciseAssignments([created], items.filter((item) => item.patientId !== patientId || item.exerciseId !== exerciseId))
        );
      } catch (error) {
        setBackendConnected(false);
        setExerciseAssignments((items) => items.filter((item) => item.id !== optimistic.id));
        setExerciseAssignmentError(
          error instanceof Error
            ? `Could not assign exercise: ${error.message}`
            : "Could not assign exercise. Check the backend and try again."
        );
      }
    } else {
      try {
        await checkBackendHealth();
        const created = await createExerciseAssignment({ patientId, exerciseId, assignedAt: optimistic.assignedAt });
        setBackendConnected(true);
        setExerciseAssignments((items) =>
          mergeExerciseAssignments([created], items.filter((item) => item.patientId !== patientId || item.exerciseId !== exerciseId))
        );
      } catch {
        // Offline/demo fallback: keep the local assignment visible in this browser.
      }
    }
    setBusyExerciseKeys((items) => items.filter((item) => item !== busyKey));
  };

  const handleUnassignExercise = async (assignmentId: string) => {
    const assignment = exerciseAssignments.find((item) => item.id === assignmentId);
    const busyKey = assignment ? `${assignment.patientId}:${assignment.exerciseId}` : assignmentId;
    setExerciseAssignmentError("");
    setBusyExerciseKeys((items) => Array.from(new Set([...items, busyKey])));
    if (backendConnected || productionAuth) {
      try {
        await deleteExerciseAssignment(assignmentId);
        setExerciseAssignments((items) => items.filter((item) => item.id !== assignmentId));
        if (assignment) await refreshPatientSideData(assignment.patientId);
        return;
      } catch (error) {
        setBackendConnected(false);
        setExerciseAssignmentError(
          error instanceof Error
            ? `Could not remove exercise: ${error.message}`
            : "Could not remove exercise. Check the backend and try again."
        );
      } finally {
        setBusyExerciseKeys((items) => items.filter((item) => item !== busyKey));
      }
      return;
    }
    setExerciseAssignments((items) => items.filter((item) => item.id !== assignmentId));
    setBusyExerciseKeys((items) => items.filter((item) => item !== busyKey));
  };

  const handleExerciseCompleted = async (assignment: ExerciseAssignment, result: NonNullable<ExerciseAssignment["result"]>) => {
    const completed = markExerciseAssignmentCompleted(assignment, result);
    setExerciseAssignments((items) => mergeExerciseAssignments([completed], items.filter((item) => item.id !== assignment.id)));

    if (backendConnected) {
      try {
        const saved = await updateExerciseAssignment(assignment.id, {
          status: "completed",
          completedAt: completed.completedAt,
          result
        });
        setExerciseAssignments((items) => mergeExerciseAssignments([saved], items.filter((item) => item.id !== assignment.id)));
      } catch {
        setBackendConnected(false);
      }
    }
  };

  const handleCreateAppointment = async (appointment: Omit<Appointment, "id" | "createdAt">) => {
    if (backendConnected) {
      try {
        const created = await createAppointment(appointment);
        setAppointments((items) => [created, ...items]);
        return;
      } catch {
        setBackendConnected(false);
      }
    }
    setAppointments((items) => [
      { ...appointment, id: `appointment-${Date.now()}`, createdAt: new Date().toISOString() },
      ...items
    ]);
  };

  const handleRegenerateSummary = async (patientId = selectedPatient?.id ?? "") => {
    if (!patientId) return;
    if (backendConnected) {
      try {
        const summary = await generateAiSummary(patientId);
        setAiSummaries((items) => ({ ...items, [patientId]: summary }));
        return;
      } catch {
        setBackendConnected(false);
      }
    }
    const patient = patients.find((item) => item.id === patientId) || selectedPatient;
    if (!patient) return;
    const weakest = detectWeakestFinger(patient.sessions);
    const recommendation = getLocalDifficultyRecommendation(patient, assignments, patient.sessions);
    setAiSummaries((items) => ({
      ...items,
      [patientId]: {
        patientId,
        generatedAt: new Date().toISOString(),
        summary: `${patient.name} completed ${getWeeklyCompletionRate(patient.id, assignments, patient.sessions)}% of assigned sessions. Latest accuracy is ${getLatestAccuracy(patient.id, patient.sessions)}%, average accuracy is ${getAverageAccuracy(patient.id, patient.sessions)}%, and improvement is ${getImprovementPercent(patient.id, patient.sessions)}%. ${fingerLabels[weakest.weakestFinger]} remains the weakest finger. ${recommendation.recommendation}. Clinician review recommended.`
      }
    }));
  };

  const handleSaveNotes = async (patientId: string, notes: string) => {
    if (backendConnected) {
      try {
        const saved = await savePatientNotes(patientId, notes);
        setPatients((items) => items.map((patient) => (patient.id === patientId ? { ...patient, notes: saved.notes } : patient)));
        return;
      } catch {
        setBackendConnected(false);
      }
    }
    setPatients((items) => items.map((patient) => (patient.id === patientId ? { ...patient, notes } : patient)));
  };

  const savePatientSession = useCallback((session: RehabSession) => {
    setPatients((items) =>
      items.map((patient) =>
        patient.id === session.patientId
          ? {
              ...patient,
              sessions: [session, ...patient.sessions.filter((item) => item.id !== session.id)]
            }
          : patient
      )
    );
  }, []);

  const startSession = async (exercise: ExerciseTemplate, assignment?: Assignment) => {
    if (!selectedPatient) return;
    let sessionId = `live-${Date.now()}`;
    let startedAt = new Date().toISOString();

    if (backendConnected) {
      try {
        const backendSession = await startBackendSession(selectedPatient.id, exercise, assignment);
        sessionId = backendSession.id;
        startedAt = backendSession.startedAt;
      } catch {
        setBackendConnected(false);
      }
    }

    setActiveSession({
      id: sessionId,
      patientId: selectedPatient.id,
      assignmentId: assignment?.id,
      exercise,
      startedAt,
      events: [],
      repsCompleted: 0,
      notes: ""
    });
    setPatientTab("live");
    setView("patient");
    navigateTo(pathForDoctorView("patient", selectedPatient.id, "live"));
  };

  const endSession = async () => {
    if (!activeSession || !selectedPatient) return;
    const completed = sessionFromDraft(activeSession);
    const averageHoldMs = completed.events.length
      ? Math.round(completed.events.reduce((sum, event) => sum + event.holdMs, 0) / completed.events.length)
      : 0;
    const averageSmoothness = completed.events.length
      ? Math.round(completed.events.reduce((sum, event) => sum + event.smoothness, 0) / completed.events.length)
      : 0;

    if (backendConnected && !activeSession.id.startsWith("live-")) {
      try {
        await endBackendSession(activeSession.id, {
          notes: activeSession.notes,
          repsCompleted: completed.repsCompleted,
          successfulReps: completed.repsCompleted,
          bestAccuracy: completed.bestFistScore,
          averageAccuracy: completed.averageAccuracy,
          holdTimeMs: averageHoldMs,
          smoothness: averageSmoothness
        });
      } catch {
        setBackendConnected(false);
      }
    }

    setPatients((items) =>
      items.map((patient) =>
        patient.id === completed.patientId
          ? { ...patient, sessions: [completed, ...patient.sessions] }
          : patient
      )
    );
    setActiveSession(null);
    setPatientTab("sessions");
    setView("patient");
    navigateTo(pathForDoctorView("patient", selectedPatient.id, "sessions"));
  };

  const loadPatientAccount = async (email: string, fullName?: string) => {
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    const userId = data.user?.id ?? `patient-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const storedSession = !supabase ? readLocalPatientSession() : null;
    const displayName =
      fullName?.trim() ||
      storedSession?.fullName?.trim() ||
      String(data.user?.user_metadata?.full_name || "").trim() ||
      email.split("@")[0] ||
      "Patient";
    if (!supabase) {
      writeLocalPatientSession({ email: email.trim(), fullName: displayName });
    }
    let patient: Patient = {
      id: userId,
      userId,
      doctorId: "doctor-1",
      name: displayName,
      age: 0,
      diagnosis: "Hand rehabilitation program",
      condition: "Hand rehabilitation program",
      therapist: demoDoctor.name,
      status: "active",
      goal: "Complete assigned hand therapy sessions",
      recoveryGoal: "Complete assigned hand therapy sessions",
      affectedHand: "right",
      notes: "",
      baselineMobility: 40,
      sessions: []
    };

    let patientBackendConnected = backendConnected;
    if (!patientBackendConnected) {
      try {
        await checkBackendHealth();
        patientBackendConnected = true;
        setBackendConnected(true);
      } catch {
        patientBackendConnected = false;
        setBackendConnected(false);
      }
    }

    if (patientBackendConnected || supabase) {
      try {
        patient = await fetchBackendPatient(userId);
      } catch {
        try {
          patient = await createBackendPatientProfile({ id: userId, fullName: displayName });
        } catch {
          // Keep the local patient shell if backend profile creation is unavailable.
        }
      }
    }

    setPatients([patient]);
    setSelectedPatientId(patient.id);
    setCurrentEvent(createGestureEvent(patient.id, "open"));
    const [nextAssignments, nextAppointments, nextAlerts, nextExerciseAssignments] =
      patientBackendConnected || supabase
        ? await Promise.all([
            fetchAssignments(patient.id).catch(() => []),
            fetchAppointments(patient.id).catch(() => []),
            fetchAlerts(patient.id).catch(() => []),
            fetchExerciseAssignments(patient.id).catch(() => [])
          ])
        : [[], [], [], []];
    setAssignments(nextAssignments);
    setAppointments(nextAppointments);
    setAlerts(nextAlerts);
    setExerciseAssignments((items) => [
      ...items.filter((assignment) => assignment.patientId !== patient.id),
      ...nextExerciseAssignments
    ]);
  };

  useEffect(() => {
    if (!loggedIn || authRole !== "patient" || !supabase) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user?.email) return;
      void loadPatientAccount(data.user.email, String(data.user.user_metadata?.full_name || ""));
    });
    return () => {
      cancelled = true;
    };
  }, [authRole, loggedIn]);

  useEffect(() => {
    if (!loggedIn || authRole !== "patient" || supabase) return;
    const session = readLocalPatientSession();
    if (!session) {
      setLoggedIn(false);
      setEntryScreen("login");
      navigateTo("/patient/sign-in", true);
      return;
    }
    void loadPatientAccount(session.email, session.fullName);
  }, [authRole, loggedIn, navigateTo]);

  const page = (() => {
    if (view === "dashboard") {
      return (
        <DoctorDashboardPage
          patients={patients}
          assignments={assignments}
          alerts={alerts}
          appointments={appointments}
          onSelectPatient={selectPatient}
        />
      );
    }
	    if (view === "appointments") {
	      return <ClinicAppointmentsPage patients={patients} appointments={appointments} onSelectPatient={selectPatient} />;
	    }
	    if (view === "patients") {
	      return <PatientsRosterPage patients={patients} assignments={assignments} alerts={alerts} loading={patientsLoading} onSelectPatient={selectPatient} />;
	    }
	    if (view === "glove-dev") {
      return <GloveDevPage patientId="demo-patient-1" />;
    }
    if (view === "exercises") {
      return (
        <ExercisesPage
          patients={patients}
          selectedPatientId={selectedPatient?.id ?? patients[0]?.id ?? ""}
          assignments={exerciseAssignments}
          loading={patientsLoading}
          busyExerciseIds={busyExerciseKeys
            .filter((key) => key.startsWith(`${selectedPatient?.id ?? patients[0]?.id ?? ""}:`))
            .map((key) => key.split(":").slice(1).join(":"))}
          error={exerciseAssignmentError}
          onSelectPatient={setSelectedPatientId}
          onAssign={handleAssignExercise}
          onUnassign={handleUnassignExercise}
        />
      );
    }
    if (view === "rehab-games" || view === "rehab-calendar" || view === "rehab-assistant") {
	      return (
	        <PatientExperience
	          patient={doctorGameLibraryPatient}
	          experienceMode="doctor-library"
	          screen={view === "rehab-calendar" ? "calendar" : view === "rehab-assistant" ? "assistant" : "home"}
	          currentEvent={currentEvent}
	          backendConnected={backendConnected}
	          onSessionSaved={savePatientSession}
          onNavigateScreen={(screen) => {
            const nextView = screen === "calendar" ? "rehab-calendar" : screen === "assistant" ? "rehab-assistant" : "rehab-games";
            openDoctorView(nextView);
          }}
	        />
	      );
	    }
	    if (view === "patient") {
      if (!selectedPatient) {
        return (
          <PatientsRosterPage
            patients={patients}
            assignments={assignments}
            alerts={alerts}
            loading={patientsLoading}
            onSelectPatient={selectPatient}
          />
        );
      }
      let patientContent: React.ReactNode;
      if (patientTab === "live") {
        patientContent = (
          <LiveSessionPage
            patient={selectedPatient}
            currentEvent={currentEvent}
            simulatorEnabled={simulatorEnabled}
            setSimulatorEnabled={setSimulatorEnabled}
            activeSession={activeSession}
            onStart={(exercise) => startSession(exercise)}
            onEnd={endSession}
            onFakeGesture={async () => {
              if (backendConnected) {
                try {
                  captureGestureEvent(await requestFakeGestureForSession(selectedPatientId, activeSession?.id));
                  return;
                } catch {
                  setBackendConnected(false);
                }
              }
              captureGestureEvent(createGestureEvent(selectedPatientId, undefined, activeSession?.id));
            }}
            onNotesChange={(notes) => setActiveSession((session) => (session ? { ...session, notes } : session))}
          />
        );
	      } else {
        patientContent = (
          <ProfilePage
            patient={selectedPatient}
            assignments={assignments}
            alerts={alerts}
            appointments={appointments}
            aiSummary={aiSummaries[selectedPatient.id]}
            difficultyRecommendation={difficultyRecommendations[selectedPatient.id]}
            activeTab={patientTab}
            onStartAssignment={(assignment) => startSession(exerciseFromAssignment(assignment), assignment)}
            onCreateAssignment={handleCreateAssignment}
            onRemoveAssignment={(assignmentId) => handleRemoveAssignment(assignmentId, selectedPatient.id)}
            onCreateAppointment={handleCreateAppointment}
            onRegenerateSummary={() => handleRegenerateSummary(selectedPatient.id)}
            onSaveNotes={(notes) => handleSaveNotes(selectedPatient.id, notes)}
          />
        );
      }
      return (
	        <PatientWorkspaceShell
	          patient={selectedPatient}
	          assignments={assignments}
	          activeTab={patientTab}
          onTabChange={(tab) => {
            setPatientTab(tab);
            navigateTo(pathForDoctorView("patient", selectedPatient.id, tab));
          }}
          onBack={() => openDoctorView("dashboard")}
        >
          {patientContent}
        </PatientWorkspaceShell>
      );
    }
    return <DoctorDashboardPage patients={patients} assignments={assignments} alerts={alerts} appointments={appointments} onSelectPatient={selectPatient} />;
  })();

  if (!loggedIn && entryScreen === "landing") {
    return (
      <LandingPage
        onSelectRole={(role) => {
          setAuthRole(role);
          setEntryScreen("login");
          navigateTo(`/${role}/sign-in`);
        }}
      />
    );
  }

  if (!loggedIn) {
    return (
      <LoginPage
        role={authRole}
        onLogin={async (email, fullName) => {
          if (authRole === "patient") {
            await loadPatientAccount(email, fullName);
            setPatientScreen("home");
            setPatientExerciseRoute(null);
            navigateTo(patientScreenPaths.home);
          } else {
            await syncTherapistProfile();
            setView("dashboard");
            navigateTo(doctorViewPaths.dashboard ?? "/doctor/dashboard");
          }
          setLoggedIn(true);
        }}
      />
    );
  }

  const handleLogout = async () => {
    await supabase?.auth.signOut();
    clearLocalPatientSession();
    setLoggedIn(false);
    setEntryScreen("landing");
    navigateTo("/");
  };

  if (authRole === "patient") {
    return (
      <PatientExperience
        patient={selectedPatient}
        screen={patientScreen}
        currentEvent={currentEvent}
        backendConnected={backendConnected}
        onSessionSaved={savePatientSession}
        assignedGames={clinicianAssignedGames}
        assignedExercises={clinicianAssignedExercises}
        clinicAppointments={clinicianAppointmentSchedule}
        onNavigateScreen={openPatientPortalScreen}
        exerciseRoute={patientExerciseRoute}
        onNavigateExercise={openPatientExerciseRoute}
        onExerciseCompleted={(assignment, result) =>
          void handleExerciseCompleted(assignment, {
            repsCompleted: result.repsCompleted,
            targetReps: result.targetReps,
            accuracy: result.accuracy,
            timeTakenSeconds: result.timeTakenSeconds
          })
        }
        onLogout={handleLogout}
      />
    );
  }

  return (
    <AppShell
      view={view}
      setView={openDoctorView}
      patient={selectedPatient}
      currentEvent={currentEvent}
      backendConnected={backendConnected}
      simulatorEnabled={simulatorEnabled}
      onLogout={handleLogout}
    >
      {page}
    </AppShell>
  );
}
