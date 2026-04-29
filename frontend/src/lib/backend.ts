import { exerciseTemplates, seedPatients } from "../data/mockData";
import type {
  AiProgressSummary,
  Alert,
  Appointment,
  Assignment,
  DifficultyRecommendation,
  ExerciseTemplate,
  FingerBends,
  FingerName,
  GestureEvent,
  GestureName,
  Patient,
  RehabSession
} from "../types";
import { clampPercent, classifyGesture, scoreAccuracy } from "./gesture";
import { supabase } from "./supabase";

const coreGestures: GestureName[] = [
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

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
export const wsUrl =
  import.meta.env.VITE_WS_URL ||
  `${apiBaseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/ws`;

type BackendGestureName = GestureName | "unknown";

type BackendPatient = {
  id: string;
  displayName?: string;
  dateOfBirth?: string | null;
  dominantHand?: "left" | "right" | "unknown";
  notes?: string | null;
  name?: string;
  condition?: string;
  recoveryGoal?: string;
  affectedHand?: "left" | "right" | "both";
  status?: Patient["status"];
  age?: number;
  latestAccuracy?: number;
  adherence?: number;
  weakestFinger?: string;
  activeAlerts?: number;
  totalSessions?: number;
  repsCompleted?: number;
  bestFistScore?: number | null;
};

type BackendSession = {
  id: string;
  patientId: string;
  exerciseId?: string | null;
  assignmentId?: string | null;
  gameId?: string;
  gameName?: string;
  status?: "active" | "ended";
  startedAt: string;
  endedAt?: string | null;
  repsRequired?: number;
  repsCompleted?: number;
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
  weakestFinger?: "thumb" | "index" | "middle" | "ring" | "pinky";
  notes?: string | null;
};

type BackendGestureEvent = Partial<FingerBends> & {
  id?: string;
  patientId?: string;
  sessionId?: string | null;
  gloveId?: string | null;
  gesture?: BackendGestureName;
  accuracy?: number | null;
  holdMs?: number;
  smoothness?: number;
  handX?: number;
  handY?: number;
  handZ?: number;
  timestamp?: string;
  recordedAt?: string;
  createdAt?: string;
  raw?: Record<string, unknown>;
  rawValues?: Record<string, number>;
};

type BackendExercise = {
  id: string;
  name: string;
  description?: string;
  targetGesture?: GestureName;
  difficulty?: number;
  config?: Record<string, unknown>;
};

export type BackendSessionPayload = {
  id: string;
  patientId: string;
  startedAt: string;
};

export type BackendHealth = {
  ok: boolean;
  service: string;
  storage?: string;
  timestamp: string;
};

export type CalibrationPayload = {
  patientId: string;
  open: FingerBends;
  closed: FingerBends;
};

function timeoutSignal(ms = 1200) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => window.clearTimeout(timeout) };
}

async function getAuthHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  if (!data.session) return {};
  return { Authorization: `Bearer ${data.session.access_token}` };
}

export async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<T> {
  const { signal, clear } = timeoutSignal(timeoutMs);
  const authHeader = await getAuthHeader();
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
        ...init?.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clear();
  }
}

function seededPatient(id: string) {
  return seedPatients.find((patient) => patient.id === id);
}

function estimateAge(dateOfBirth?: string | null) {
  if (!dateOfBirth) return 0;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

function stableNumber(input: string, min: number, max: number) {
  const seed = input.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return min + (seed % (max - min + 1));
}

function normalizeGesture(event: BackendGestureEvent): GestureName {
  if (event.gesture && coreGestures.includes(event.gesture as GestureName)) {
    return event.gesture as GestureName;
  }
  return classifyGesture({
    thumb: event.thumb ?? 0,
    index: event.index ?? 0,
    middle: event.middle ?? 0,
    ring: event.ring ?? 0,
    pinky: event.pinky ?? 0
  });
}

export function mapBackendGestureEvent(event: BackendGestureEvent, fallbackPatientId: string): GestureEvent {
  const bends = {
    thumb: clampPercent(event.thumb ?? 0),
    index: clampPercent(event.index ?? 0),
    middle: clampPercent(event.middle ?? 0),
    ring: clampPercent(event.ring ?? 0),
    pinky: clampPercent(event.pinky ?? 0)
  };
  const gesture = normalizeGesture({ ...event, ...bends });
  const id = event.id || `backend-event-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    patientId: event.patientId || fallbackPatientId,
    sessionId: event.sessionId || undefined,
    gesture,
    timestamp: event.timestamp || event.recordedAt || event.createdAt || new Date().toISOString(),
    accuracy: clampPercent(event.accuracy ?? scoreAccuracy(bends, gesture)),
    holdMs: event.holdMs ?? stableNumber(id, 640, 2300),
    smoothness: clampPercent(event.smoothness ?? stableNumber(id, 62, 94)),
    handX: event.handX,
    handY: event.handY,
    handZ: event.handZ,
    rawValues: event.rawValues,
    ...bends
  };
}

export async function fetchLatestGloveEvent(): Promise<GestureEvent | null> {
  try {
    const event = await apiFetch<BackendGestureEvent>("/api/glove/latest", undefined, 1200);
    if (!event?.patientId) return null;
    return mapBackendGestureEvent(event, event.patientId);
  } catch {
    return null;
  }
}

function countCompletedReps(events: GestureEvent[]) {
  return events.reduce((count, event, index) => {
    const previous = events[index - 1];
    return count + (previous?.gesture === "fist" && event.gesture === "open" ? 1 : 0);
  }, 0);
}

function averageAccuracy(events: GestureEvent[]) {
  if (events.length === 0) return 0;
  return clampPercent(events.reduce((sum, event) => sum + event.accuracy, 0) / events.length);
}

function bestFistScore(events: GestureEvent[]) {
  return events
    .filter((event) => event.gesture === "fist")
    .reduce((best, event) => Math.max(best, event.accuracy), 0);
}

function mapBackendSession(session: BackendSession, events: GestureEvent[]): RehabSession {
  const exercise = exerciseTemplates.find((item) => item.id === session.exerciseId) ?? exerciseTemplates[0];
  const targetReps = exercise.targetReps;
  const repsCompleted = session.repsCompleted ?? countCompletedReps(events);
  const accuracy = session.accuracy ?? averageAccuracy(events);

  return {
    id: session.id,
    patientId: session.patientId,
    assignmentId: session.assignmentId,
    gameId: session.gameId || session.exerciseId || exercise.id,
    gameName: session.gameName || exercise.name,
    exerciseId: session.exerciseId || exercise.id,
    exerciseName: session.gameName || exercise.name,
    startedAt: session.startedAt,
    endedAt: session.endedAt || new Date().toISOString(),
    repsRequired: session.repsRequired ?? targetReps,
    repsCompleted,
    targetReps: session.repsRequired ?? targetReps,
    successfulReps: session.successfulReps ?? repsCompleted,
    failedAttempts: session.failedAttempts ?? 0,
    accuracy,
    timeTaken: session.timeTaken,
    score: session.score,
    inputMode: session.inputMode || "demo",
    painBefore: session.painBefore ?? 0,
    painAfter: session.painAfter ?? 0,
    fatigueBefore: session.fatigueBefore ?? 0,
    fatigueAfter: session.fatigueAfter ?? 0,
    weakestFinger: session.weakestFinger,
    averageAccuracy: accuracy,
    bestFistScore: bestFistScore(events) || accuracy,
    fatigueWarnings: Math.max(0, Math.floor((targetReps - repsCompleted) / 3)),
    notes: session.notes || "Backend session imported from glove API.",
    events
  };
}

function mapBackendPatient(patient: BackendPatient, sessions: RehabSession[]): Patient {
  const seeded = seededPatient(patient.id);
  return {
    id: patient.id,
    userId: patient.id,
    doctorId: "doctor-1",
    name: patient.name || patient.displayName || seeded?.name || "New rehab patient",
    age: patient.age || seeded?.age || estimateAge(patient.dateOfBirth),
    diagnosis: patient.condition || seeded?.diagnosis || patient.notes || "Glove rehabilitation program",
    condition: patient.condition || seeded?.condition,
    therapist: seeded?.therapist || "Dr. Singh",
    status: patient.status || seeded?.status || "active",
    goal: patient.recoveryGoal || seeded?.goal || patient.notes || "Improve finger mobility with guided glove sessions",
    recoveryGoal: patient.recoveryGoal || seeded?.recoveryGoal,
    affectedHand: patient.affectedHand || (patient.dominantHand === "unknown" ? undefined : patient.dominantHand),
    notes: patient.notes || seeded?.notes,
    createdAt: seeded?.createdAt,
    baselineMobility: seeded?.baselineMobility ?? 40,
    sessions: sessions.length > 0 ? sessions : seeded?.sessions ?? []
  };
}

export async function checkBackendHealth(): Promise<BackendHealth> {
  return apiFetch<BackendHealth>("/health", undefined, 1000);
}

export async function fetchBackendPatients(): Promise<Patient[]> {
  const backendPatients = await apiFetch<BackendPatient[]>("/api/patients");
  const patients = await Promise.all(
    backendPatients.map(async (patient) => {
      const backendSessions = await apiFetch<BackendSession[]>(`/api/patients/${patient.id}/sessions`);
      const sessions = await Promise.all(
        backendSessions.map(async (session) => {
          const backendEvents = await apiFetch<BackendGestureEvent[]>(`/api/sessions/${session.id}/events`);
          const events = backendEvents.map((event) => mapBackendGestureEvent(event, patient.id));
          return mapBackendSession(session, events);
        })
      );

      return mapBackendPatient(patient, sessions);
    })
  );

  return patients.length > 0 ? patients : seedPatients;
}

export async function fetchBackendExercises(): Promise<ExerciseTemplate[]> {
  const backendExercises = await apiFetch<BackendExercise[]>("/api/exercises");
  return backendExercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    goal: exercise.description || "Backend exercise",
    targetGesture: exercise.targetGesture || "fist",
    durationMinutes: Number(exercise.config?.durationMinutes || 8),
    targetReps: Number(exercise.config?.targetReps || 18),
    difficulty: exercise.difficulty && exercise.difficulty > 2 ? "medium" : "easy",
    instructions: exercise.description || "Use the glove to complete controlled gesture reps."
  }));
}

export type BackendSessionStartOptions = {
  painBefore?: number;
  fatigueBefore?: number;
  inputMode?: "camera" | "glove" | "demo";
  notes?: string;
};

export async function startBackendSession(
  patientId: string,
  exercise: ExerciseTemplate,
  assignment?: Assignment,
  startOptions?: BackendSessionStartOptions
): Promise<BackendSessionPayload> {
  const session = await apiFetch<BackendSession>(
    "/api/sessions/start",
    {
      method: "POST",
      body: JSON.stringify({
        patientId,
        assignmentId: assignment?.id,
        gameId: assignment?.gameId || exercise.id,
        gameName: assignment?.gameName || exercise.name,
        inputMode: startOptions?.inputMode ?? "demo",
        painBefore: startOptions?.painBefore ?? 0,
        fatigueBefore: startOptions?.fatigueBefore ?? 0,
        notes: startOptions?.notes ?? `Started from frontend: ${exercise.name}`
      })
    },
    1500
  );

  return {
    id: session.id,
    patientId: session.patientId,
    startedAt: session.startedAt
  };
}

export type EndBackendSessionPayload = {
  notes?: string;
  repsCompleted: number;
  successfulReps: number;
  bestAccuracy: number;
  averageAccuracy: number;
  holdTimeMs: number;
  smoothness: number;
  failedAttempts?: number;
  accuracy?: number;
  timeTaken?: number;
  painAfter?: number;
  fatigueAfter?: number;
  weakestFinger?: FingerName;
  exerciseResultMetadata?: Record<string, unknown>;
};

export async function endBackendSession(sessionId: string, payload: EndBackendSessionPayload) {
  return apiFetch(`/api/sessions/${sessionId}/end`, {
    method: "POST",
    body: JSON.stringify({
      notes: payload.notes,
      repsCompleted: payload.repsCompleted,
      successfulReps: payload.successfulReps,
      failedAttempts: payload.failedAttempts,
      accuracy: payload.accuracy ?? payload.averageAccuracy,
      timeTaken: payload.timeTaken,
      painAfter: payload.painAfter,
      fatigueAfter: payload.fatigueAfter,
      weakestFinger: payload.weakestFinger,
      exerciseResult: {
        repsCompleted: payload.repsCompleted,
        successfulReps: payload.successfulReps,
        bestAccuracy: payload.bestAccuracy,
        averageAccuracy: payload.averageAccuracy,
        holdTimeMs: payload.holdTimeMs,
        smoothness: payload.smoothness,
        metadata: { source: "frontend-vr-integrated-app", ...payload.exerciseResultMetadata }
      }
    })
  });
}

/** Push patient-game gesture samples to the backend so clinician sessions show the same event history. */
export async function uploadPatientSessionGestures(sessionId: string, patientId: string, events: GestureEvent[]): Promise<void> {
  const slice = events.length > 200 ? events.slice(-200) : events;
  const batches: GestureEvent[][] = [];
  for (let i = 0; i < slice.length; i += 25) {
    batches.push(slice.slice(i, i + 25));
  }
  for (const batch of batches) {
    await Promise.allSettled(
      batch.map((event) => {
        const hx = event.handX;
        const hy = event.handY;
        const hz = event.handZ;
        return apiFetch("/api/glove/event", {
          method: "POST",
          body: JSON.stringify({
            patientId,
            sessionId,
            gesture: event.gesture,
            thumb: event.thumb,
            index: event.index,
            middle: event.middle,
            ring: event.ring,
            pinky: event.pinky,
            handX: typeof hx === "number" ? Math.max(0, Math.min(1, hx > 1 ? hx / 100 : hx)) : undefined,
            handY: typeof hy === "number" ? Math.max(0, Math.min(1, hy > 1 ? hy / 100 : hy)) : undefined,
            handZ:
              hz === undefined
                ? undefined
                : typeof hz === "number"
                  ? Math.max(0, Math.min(1, (Math.max(-100, Math.min(100, hz)) + 100) / 200))
                  : hz,
            accuracy: event.accuracy,
            timestamp: event.timestamp
          })
        }).catch(() => undefined)
      })
    );
  }
}

export async function requestFakeGesture(patientId: string): Promise<GestureEvent> {
  const event = await apiFetch<BackendGestureEvent>(
    "/api/dev/fake-gesture",
    {
      method: "POST",
      body: JSON.stringify({ patientId })
    },
    1500
  );
  return mapBackendGestureEvent(event, patientId);
}

export async function requestFakeGestureForSession(patientId: string, sessionId?: string): Promise<GestureEvent> {
  const event = await apiFetch<BackendGestureEvent>(
    "/api/dev/fake-gesture",
    {
      method: "POST",
      body: JSON.stringify({ patientId, sessionId })
    },
    1500
  );
  return mapBackendGestureEvent(event, patientId);
}

export async function fetchAssignments(patientId: string): Promise<Assignment[]> {
  return apiFetch<Assignment[]>(`/api/patients/${patientId}/assignments`);
}

export async function createAssignment(payload: Omit<Assignment, "id" | "createdAt" | "updatedAt" | "status"> & { status?: Assignment["status"] }) {
  return apiFetch<Assignment>("/api/assignments", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function patchAssignment(id: string, payload: Partial<Assignment>) {
  return apiFetch<Assignment>(`/api/assignments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteAssignment(id: string): Promise<void> {
  const { signal, clear } = timeoutSignal(2500);
  const authHeader = await getAuthHeader();
  try {
    const response = await fetch(`${apiBaseUrl}/api/assignments/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
      headers: {
        ...authHeader
      }
    });
    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
    }
  } finally {
    clear();
  }
}

export async function fetchAppointments(patientId?: string): Promise<Appointment[]> {
  return apiFetch<Appointment[]>(patientId ? `/api/patients/${patientId}/appointments` : "/api/appointments");
}

export async function createAppointment(payload: Omit<Appointment, "id" | "createdAt">) {
  return apiFetch<Appointment>("/api/appointments", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchAlerts(patientId?: string): Promise<Alert[]> {
  return apiFetch<Alert[]>(patientId ? `/api/patients/${patientId}/alerts` : "/api/alerts");
}

export async function generateAiSummary(patientId: string): Promise<AiProgressSummary> {
  return apiFetch<AiProgressSummary>("/api/ai/progress-summary", {
    method: "POST",
    body: JSON.stringify({ patientId })
  });
}

export async function fetchDifficultyRecommendation(patientId: string): Promise<DifficultyRecommendation> {
  return apiFetch<DifficultyRecommendation>(`/api/patients/${patientId}/difficulty-recommendation`);
}

export async function savePatientNotes(patientId: string, notes: string): Promise<Patient> {
  const patient = await apiFetch<BackendPatient>(`/api/patients/${patientId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
  return mapBackendPatient(patient, seededPatient(patientId)?.sessions ?? []);
}

export async function syncTherapistProfile(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  try {
    await apiFetch("/api/auth/me", {
      method: "POST",
      body: JSON.stringify({ name: data.user.email })
    });
  } catch {
    // Non-fatal — dashboard still works without therapist row sync
  }
}

export function connectGestureStream(
  patientId: string,
  onEvent: (event: GestureEvent) => void,
  onStatus?: (connected: boolean) => void
) {
  let socket: WebSocket;
  let manuallyClosed = false;

  try {
    socket = new WebSocket(wsUrl);
  } catch {
    onStatus?.(false);
    return () => undefined;
  }

  socket.addEventListener("open", () => {
    onStatus?.(true);
    socket.send(JSON.stringify({ type: "subscribe", patientId }));
  });

  socket.addEventListener("message", (message) => {
    let parsed: { type?: string; event?: BackendGestureEvent } & BackendGestureEvent;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = parsed.type === "gesture:event" ? parsed.event : parsed;
    if (!event?.patientId) return;
    onEvent(mapBackendGestureEvent(event, patientId));
  });

  socket.addEventListener("error", () => onStatus?.(false));
  socket.addEventListener("close", () => {
    if (!manuallyClosed) {
      onStatus?.(false);
    }
  });

  return () => {
    manuallyClosed = true;
    socket.close();
  };
}
