import { create } from "zustand";
import { createVrGestureEvent, DEMO_PATIENT_ID, type VrGestureEvent } from "../types/gesture";

export type Vec3 = [number, number, number];

export type Ball = {
  id: string;
  color: string;
  position: Vec3;
  scored: boolean;
};

export type RepResult = {
  id: string;
  success: boolean;
  gesture: string;
  releasedAt: string;
  releasePosition: Vec3;
};

type GameState = {
  patientId: string;
  sessionId: string;
  startedAt: string;
  gestureEvent: VrGestureEvent;
  handPosition: Vec3;
  balls: Ball[];
  selectedBallId: string | null;
  heldBallId: string | null;
  repsCompleted: number;
  attempts: number;
  repResults: RepResult[];
  lastResult: "Ready" | "Grabbed" | "Scored" | "Missed";
  setPatientId: (patientId: string) => void;
  setGestureEvent: (event: VrGestureEvent) => void;
  setHandPosition: (position: Vec3) => void;
  selectNearestBall: (radius: number) => string | null;
  grabSelectedBall: () => void;
  moveHeldBall: () => void;
  releaseHeldBall: () => void;
  resetSession: () => void;
};

const basketCenter: Vec3 = [2.25, 0.22, -1.25];
const basketRadius = 0.78;

const initialBalls = (): Ball[] => [
  { id: "ball-1", color: "#ef4444", position: [-2.2, 0.26, -1.8], scored: false },
  { id: "ball-2", color: "#14b8a6", position: [-1.6, 0.26, -0.7], scored: false },
  { id: "ball-3", color: "#f59e0b", position: [-0.6, 0.26, -1.55], scored: false },
  { id: "ball-4", color: "#3b82f6", position: [0.2, 0.26, -0.35], scored: false },
  { id: "ball-5", color: "#a855f7", position: [-1.75, 0.26, 0.55], scored: false }
];

const newSessionId = () => `vr-session-${Date.now()}`;

function createSessionState(patientId: string) {
  return {
    patientId,
    sessionId: newSessionId(),
    startedAt: new Date().toISOString(),
    gestureEvent: createVrGestureEvent("open", patientId),
    handPosition: [0, 0.78, 0] as Vec3,
    balls: initialBalls(),
    selectedBallId: null,
    heldBallId: null,
    repsCompleted: 0,
    attempts: 0,
    repResults: [],
    lastResult: "Ready" as const
  };
}

function distanceOnTable(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function isInsideBasket(position: Vec3) {
  return distanceOnTable(position, basketCenter) <= basketRadius;
}

export const useGameStore = create<GameState>((set, get) => ({
  ...createSessionState(DEMO_PATIENT_ID),

  setPatientId: (patientId) => {
    if (get().patientId === patientId) return;
    set(createSessionState(patientId));
  },

  setGestureEvent: (event) => set({ gestureEvent: event }),
  setHandPosition: (position) => set({ handPosition: position }),

  selectNearestBall: (radius) => {
    const { balls, handPosition, heldBallId } = get();
    if (heldBallId) return heldBallId;

    const nearest = balls
      .filter((ball) => !ball.scored)
      .map((ball) => ({ ball, distance: distanceOnTable(ball.position, handPosition) }))
      .filter(({ distance }) => distance <= radius)
      .sort((a, b) => a.distance - b.distance)[0]?.ball;

    set({ selectedBallId: nearest?.id ?? null });
    return nearest?.id ?? null;
  },

  grabSelectedBall: () => {
    const { selectedBallId, heldBallId } = get();
    if (!selectedBallId || heldBallId) return;
    set({ heldBallId: selectedBallId, lastResult: "Grabbed" });
  },

  moveHeldBall: () => {
    const { balls, handPosition, heldBallId } = get();
    if (!heldBallId) return;

    set({
      balls: balls.map((ball) =>
        ball.id === heldBallId
          ? { ...ball, position: [handPosition[0], handPosition[1] - 0.26, handPosition[2]] }
          : ball
      )
    });
  },

  releaseHeldBall: () => {
    const { balls, gestureEvent, handPosition, heldBallId } = get();
    if (!heldBallId) return;

    const success = isInsideBasket(handPosition);
    const releasePosition: Vec3 = success
      ? [basketCenter[0], 0.33, basketCenter[2]]
      : [handPosition[0], 0.26, handPosition[2]];
    const result: RepResult = {
      id: `vr-rep-${Date.now()}`,
      success,
      gesture: gestureEvent.gesture,
      releasedAt: new Date().toISOString(),
      releasePosition
    };

    set((state) => ({
      balls: balls.map((ball) =>
        ball.id === heldBallId
          ? { ...ball, position: releasePosition, scored: success || ball.scored }
          : ball
      ),
      selectedBallId: null,
      heldBallId: null,
      attempts: state.attempts + 1,
      repsCompleted: state.repsCompleted + (success ? 1 : 0),
      repResults: [...state.repResults, result],
      lastResult: success ? "Scored" : "Missed"
    }));
  },

  resetSession: () => set(createSessionState(get().patientId))
}));
