import { fingerNames } from "../lib/gesture";
import type { FingerBends, FingerName, FingerTapCalibrationProfile } from "../types";
import { calibratedBendsFromRaw } from "./ballPickupGrip";

export type FingerTapDetectorState = {
  armed: Record<FingerName, boolean>;
  lastTapAt: Record<FingerName, number>;
  candidate: FingerName | null;
  candidateFrames: number;
};

export type DetectedFingerTap = {
  finger: FingerName;
  timestamp: number;
  strength: number;
  confidence: number;
  bends: FingerBends;
};

export type FingerTapDetectionResult = {
  state: FingerTapDetectorState;
  taps: DetectedFingerTap[];
  bends: FingerBends;
};

export type FingerTapCaptureQuality = {
  ok: boolean;
  status: "stable" | "weak-signal" | "too-noisy" | "not-enough-samples";
  message: string;
  sampleCount: number;
  signal: number;
  stability: number;
};

const fallbackPressThreshold = 58;
const fallbackReleaseThreshold = 34;
const fallbackMinLeadOverNextFinger = 12;
const debounceMs = 220;
const framesRequired = 2;
const factorPressThreshold = 72;
const factorReleaseThreshold = 38;
const factorAmbiguityMargin = 14;
const minCalibrationSamples = 6;

export function initialFingerTapDetectorState(): FingerTapDetectorState {
  return {
    armed: {
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true
    },
    lastTapAt: {
      thumb: 0,
      index: 0,
      middle: 0,
      ring: 0,
      pinky: 0
    },
    candidate: null,
    candidateFrames: 0
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => Math.pow(value - mean, 2)));
  return Math.sqrt(variance);
}

function profileList(
  profiles?: Partial<Record<FingerName, FingerTapCalibrationProfile>>
): FingerTapCalibrationProfile[] {
  return fingerNames
    .map((finger) => profiles?.[finger])
    .filter((profile): profile is FingerTapCalibrationProfile => Boolean(profile));
}

function strongestFinger(bends: FingerBends): { finger: FingerName; value: number; next: number } {
  const sorted = fingerNames
    .map((finger) => ({ finger, value: bends[finger] }))
    .sort((a, b) => b.value - a.value);
  return {
    finger: sorted[0].finger,
    value: sorted[0].value,
    next: sorted[1]?.value ?? 0
  };
}

function movementFactorForProfile(bends: FingerBends, profile: FingerTapCalibrationProfile) {
  return clamp((bends[profile.finger] / Math.max(profile.bends[profile.finger], 1)) * 100, 0, 140);
}

function detectWithProfiles(
  bends: FingerBends,
  previous: FingerTapDetectorState,
  profiles: Partial<Record<FingerName, FingerTapCalibrationProfile>>,
  timestamp: number
): FingerTapDetectionResult {
  const state: FingerTapDetectorState = {
    armed: { ...previous.armed },
    lastTapAt: { ...previous.lastTapAt },
    candidate: previous.candidate ?? null,
    candidateFrames: previous.candidateFrames ?? 0
  };
  const taps: DetectedFingerTap[] = [];
  const availableProfiles = profileList(profiles);
  if (!availableProfiles.length) {
    return detectFingerTapsFromBends(bends, previous, timestamp);
  }

  for (const profile of availableProfiles) {
    const factor = movementFactorForProfile(bends, profile);
    if (factor <= factorReleaseThreshold || bends[profile.finger] <= profile.releaseThreshold) {
      state.armed[profile.finger] = true;
    }
  }

  const ranked = availableProfiles
    .map((profile) => ({
      profile,
      factor: movementFactorForProfile(bends, profile)
    }))
    .sort((a, b) => b.factor - a.factor);
  const best = ranked[0];
  if (!best) return { state, taps, bends };

  const next = ranked[1]?.factor ?? 0;
  const finger = best.profile.finger;
  const clearWinner = best.factor - next >= factorAmbiguityMargin;
  const pressed = best.factor >= factorPressThreshold && bends[finger] >= best.profile.pressThreshold;
  const ready = state.armed[finger] && timestamp - state.lastTapAt[finger] >= debounceMs;

  if (!pressed || !clearWinner || !ready) {
    state.candidate = null;
    state.candidateFrames = 0;
    return { state, taps, bends };
  }

  state.candidateFrames = state.candidate === finger ? state.candidateFrames + 1 : 1;
  state.candidate = finger;
  if (state.candidateFrames < framesRequired) {
    return { state, taps, bends };
  }

  state.armed[finger] = false;
  state.lastTapAt[finger] = timestamp;
  state.candidate = null;
  state.candidateFrames = 0;
  taps.push({
    finger,
    timestamp,
    strength: best.factor,
    confidence: best.factor,
    bends
  });

  return { state, taps, bends };
}

export function buildFingerTapProfiles(
  open: FingerBends | undefined,
  closed: FingerBends | undefined,
  fingerTaps: Partial<Record<FingerName, FingerBends>>
): Partial<Record<FingerName, FingerTapCalibrationProfile>> {
  if (!open || !closed) return {};
  const profiles: Partial<Record<FingerName, FingerTapCalibrationProfile>> = {};

  for (const finger of fingerNames) {
    const raw = fingerTaps[finger];
    if (!raw) continue;
    const bends = calibratedBendsFromRaw(raw as unknown as Record<string, number>, open, closed);
    const primary = bends[finger];
    const signal = Math.max(...fingerNames.map((name) => bends[name]));

    profiles[finger] = {
      finger,
      raw,
      bends,
      signal: Math.round(signal),
      stability: 84,
      pressThreshold: clamp(Math.round(primary * 0.42), 18, 58),
      releaseThreshold: clamp(Math.round(primary * 0.22), 10, 34),
      confidenceThreshold: factorPressThreshold
    };
  }

  return profiles;
}

export function assessFingerTapCaptureQuality({
  finger,
  samples,
  averaged,
  open,
  closed,
  existingFingerTaps: _existingFingerTaps
}: {
  finger: FingerName;
  samples: Array<Record<string, number>>;
  averaged: FingerBends | null;
  open?: FingerBends;
  closed?: FingerBends;
  existingFingerTaps: Partial<Record<FingerName, FingerBends>>;
}): FingerTapCaptureQuality {
  if (!averaged || samples.length < minCalibrationSamples) {
    return {
      ok: false,
      status: "not-enough-samples",
      message: "Need more fresh glove frames. Hold steady and try again.",
      sampleCount: samples.length,
      signal: 0,
      stability: 0
    };
  }
  if (!open || !closed) {
    return {
      ok: true,
      status: "stable",
      message: "Captured.",
      sampleCount: samples.length,
      signal: 100,
      stability: 100
    };
  }

  const bends = calibratedBendsFromRaw(averaged as unknown as Record<string, number>, open, closed);
  const primary = bends[finger];
  const maxNoise = Math.max(
    ...fingerNames.map((name) => stdDev(samples.map((sample) => sample[name] ?? averaged[name])))
  );
  const range = Math.max(1, Math.abs(closed[finger] - open[finger]));
  const noisePct = (maxNoise / range) * 100;
  const stability = clamp(Math.round(100 - noisePct * 2.5), 0, 100);

  if (primary < 28) {
    return {
      ok: false,
      status: "weak-signal",
      message: `${finger} did not move far enough from open hand. Hold the tap a little deeper.`,
      sampleCount: samples.length,
      signal: Math.round(primary),
      stability
    };
  }
  if (stability < 58) {
    return {
      ok: false,
      status: "too-noisy",
      message: "Glove values changed too much during the hold. Keep the tap steady and try again.",
      sampleCount: samples.length,
      signal: Math.round(primary),
      stability
    };
  }

  return {
    ok: true,
    status: "stable",
    message: "Stable finger movement factor captured.",
    sampleCount: samples.length,
    signal: Math.round(primary),
    stability
  };
}

export function detectFingerTapsFromBends(
  bends: FingerBends,
  previous: FingerTapDetectorState,
  timestamp = Date.now(),
  profiles?: Partial<Record<FingerName, FingerTapCalibrationProfile>>
): FingerTapDetectionResult {
  if (profiles && profileList(profiles).length) {
    return detectWithProfiles(bends, previous, profiles, timestamp);
  }

  const state: FingerTapDetectorState = {
    armed: { ...previous.armed },
    lastTapAt: { ...previous.lastTapAt },
    candidate: previous.candidate ?? null,
    candidateFrames: previous.candidateFrames ?? 0
  };
  const taps: DetectedFingerTap[] = [];

  for (const finger of fingerNames) {
    if (bends[finger] <= fallbackReleaseThreshold) {
      state.armed[finger] = true;
    }
  }

  const strongest = strongestFinger(bends);
  const isolated = strongest.value - strongest.next >= fallbackMinLeadOverNextFinger;
  const ready = state.armed[strongest.finger] && timestamp - state.lastTapAt[strongest.finger] >= debounceMs;

  if (strongest.value >= fallbackPressThreshold && isolated && ready) {
    state.armed[strongest.finger] = false;
    state.lastTapAt[strongest.finger] = timestamp;
    taps.push({
      finger: strongest.finger,
      timestamp,
      strength: Math.max(0, Math.min(100, strongest.value - strongest.next)),
      confidence: Math.max(0, Math.min(100, strongest.value - strongest.next)),
      bends
    });
  }

  return { state, taps, bends };
}

export function detectFingerTapsFromRaw(
  rawValues: Record<string, number>,
  open: FingerBends,
  closed: FingerBends,
  previous: FingerTapDetectorState,
  timestamp = Date.now(),
  profiles?: Partial<Record<FingerName, FingerTapCalibrationProfile>>
): FingerTapDetectionResult {
  const bends = calibratedBendsFromRaw(rawValues, open, closed);
  return detectFingerTapsFromBends(bends, previous, timestamp, profiles);
}
