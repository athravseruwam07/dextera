import type { FingerName, GestureEvent, PatientCareAssignment } from "../types";

/** Completion payload passed from patient games → session flow (`PatientGames`, `FingerTapPianoLanes`, etc.). */
export type GamePlayResult = {
  repsCompleted: number;
  successfulReps: number;
  failedAttempts: number;
  accuracy: number;
  timeTakenSeconds: number;
  gameMetrics?: Record<string, unknown>;
  /** Highest consecutive correct taps in a row (Finger Tap Piano, etc.). */
  bestStreak?: number;
  weakestFinger?: FingerName;
  events: GestureEvent[];
};

export type PatientGameSharedProps = {
  assignment: PatientCareAssignment;
  onComplete: (result: GamePlayResult) => void;
};
