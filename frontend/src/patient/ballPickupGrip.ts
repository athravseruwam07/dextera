import { fingerNames } from "../lib/gesture";
import type { FingerBends, GestureName } from "../types";

export type OpenFistGesture = Extract<GestureName, "open" | "fist">;

export type GripClassifierState = {
  gesture: OpenFistGesture;
  candidate: OpenFistGesture | null;
  candidateFrames: number;
};

export type GripClassification = {
  state: GripClassifierState;
  gesture: OpenFistGesture;
  bendAverage: number;
  changed: boolean;
};

export type BallPickupGripAction = "none" | "grab" | "release" | "closed-away" | "opened-empty";

const closeThreshold = 68;
const releaseThreshold = 38;
const framesRequired = 2;

export const initialGripClassifierState: GripClassifierState = {
  gesture: "open",
  candidate: null,
  candidateFrames: 0
};

export function averageBendPercent(bends: FingerBends): number {
  return Math.round(fingerNames.reduce((sum, finger) => sum + bends[finger], 0) / fingerNames.length);
}

export function calibratedBendsFromRaw(rawValues: Record<string, number>, open: FingerBends, closed: FingerBends): FingerBends {
  return fingerNames.reduce<FingerBends>(
    (acc, finger) => {
      const range = closed[finger] - open[finger];
      const percent = range === 0 ? 0 : Math.round((((rawValues[finger] ?? 0) - open[finger]) / range) * 100);
      acc[finger] = Math.max(0, Math.min(100, percent));
      return acc;
    },
    { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }
  );
}

export function averageRawSamples(samples: Array<Record<string, number>>): FingerBends | null {
  if (!samples.length) return null;
  return fingerNames.reduce<FingerBends>(
    (acc, finger) => {
      acc[finger] = Math.round(samples.reduce((sum, sample) => sum + (sample[finger] ?? 0), 0) / samples.length);
      return acc;
    },
    { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }
  );
}

export function classifyGripFrame(
  bends: FingerBends,
  previous: GripClassifierState = initialGripClassifierState
): GripClassification {
  const bendAverage = averageBendPercent(bends);
  const target: OpenFistGesture | null =
    previous.gesture === "open"
      ? bendAverage >= closeThreshold
        ? "fist"
        : null
      : bendAverage <= releaseThreshold
        ? "open"
        : null;

  if (!target) {
    const nextState = { ...previous, candidate: null, candidateFrames: 0 };
    return { state: nextState, gesture: nextState.gesture, bendAverage, changed: false };
  }

  const candidateFrames = previous.candidate === target ? previous.candidateFrames + 1 : 1;
  if (candidateFrames < framesRequired) {
    const nextState = { ...previous, candidate: target, candidateFrames };
    return { state: nextState, gesture: nextState.gesture, bendAverage, changed: false };
  }

  const nextState: GripClassifierState = {
    gesture: target,
    candidate: null,
    candidateFrames: 0
  };
  return { state: nextState, gesture: target, bendAverage, changed: previous.gesture !== target };
}

export function ballPickupGripAction({
  previousGrip,
  nextGrip,
  canReachBall,
  held
}: {
  previousGrip: OpenFistGesture;
  nextGrip: OpenFistGesture;
  canReachBall: boolean;
  held: boolean;
}): BallPickupGripAction {
  if (previousGrip === nextGrip) return "none";
  if (previousGrip === "open" && nextGrip === "fist") return canReachBall ? "grab" : "closed-away";
  if (previousGrip === "fist" && nextGrip === "open") return held ? "release" : "opened-empty";
  return "none";
}
