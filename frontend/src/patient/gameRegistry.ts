import type { GameId } from "../types";
import type { PatientGloveMode } from "./input";

export type CalibrationRequirement = "open-fist" | "finger-taps" | "point-pinch";

export type PatientGameManifest = {
  id: GameId;
  name: string;
  gloveMode: PatientGloveMode;
  calibration: CalibrationRequirement[];
  inputSummary: string;
  fullscreen: "optional" | "required";
  audio: boolean;
  resultMetrics: string[];
};

export const patientGameManifests: Record<GameId, PatientGameManifest> = {
  "ball-pickup": {
    id: "ball-pickup",
    name: "Ball Pickup",
    gloveMode: "ball-pickup",
    calibration: ["open-fist"],
    inputSummary: "Pointer or keyboard moves the hand; calibrated open/fist grabs and drops.",
    fullscreen: "optional",
    audio: false,
    resultMetrics: ["reps", "failedDrops", "accuracy", "releaseAccuracy", "elapsedSeconds"]
  },
  "finger-tap-piano": {
    id: "finger-tap-piano",
    name: "Finger Tap Piano",
    gloveMode: "finger-tap",
    calibration: ["open-fist", "finger-taps"],
    inputSummary: "Raw glove frames generate calibrated tap_thumb through tap_pinky events.",
    fullscreen: "optional",
    audio: true,
    resultMetrics: ["hits", "misses", "bestStreak", "missesByFinger", "tapConfidence"]
  },
  "bubble-pop": {
    id: "bubble-pop",
    name: "Bubble Pop",
    gloveMode: "raw",
    calibration: ["open-fist", "point-pinch"],
    inputSummary: "Pointer or keyboard aims; calibrated point or pinch confirms a pop.",
    fullscreen: "optional",
    audio: false,
    resultMetrics: ["popped", "wrongHits", "timeLeft", "averagePopIntervalMs"]
  },
  "carrom-flick": {
    id: "carrom-flick",
    name: "Carrom",
    gloveMode: "raw",
    calibration: ["open-fist"],
    inputSummary: "Pointer or trackpad places and aims; bridge flick, fist release, or pointer release shoots.",
    fullscreen: "required",
    audio: false,
    resultMetrics: ["shots", "pockets", "fouls", "aimJitter", "pullConsistency", "timeToAim"]
  }
};

export function manifestForGame(gameId: GameId) {
  return patientGameManifests[gameId];
}
