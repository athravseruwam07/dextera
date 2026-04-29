import { describe, expect, it } from "vitest";
import type { FingerBends } from "../types";
import {
  assessFingerTapCaptureQuality,
  buildFingerTapProfiles,
  detectFingerTapsFromBends,
  detectFingerTapsFromRaw,
  initialFingerTapDetectorState
} from "./fingerTapInput";

const bends = (value: number): FingerBends => ({
  thumb: value,
  index: value,
  middle: value,
  ring: value,
  pinky: value
});

const open = bends(1000);
const fist = bends(2000);

const rawFromPercent = (percent: FingerBends): FingerBends => ({
  thumb: 1000 + percent.thumb * 10,
  index: 1000 + percent.index * 10,
  middle: 1000 + percent.middle * 10,
  ring: 1000 + percent.ring * 10,
  pinky: 1000 + percent.pinky * 10
});

const calibratedFingerTaps = {
  thumb: rawFromPercent({ thumb: 88, index: 28, middle: 10, ring: 8, pinky: 8 }),
  index: rawFromPercent({ thumb: 24, index: 90, middle: 32, ring: 10, pinky: 8 }),
  middle: rawFromPercent({ thumb: 8, index: 28, middle: 92, ring: 36, pinky: 12 }),
  ring: rawFromPercent({ thumb: 8, index: 10, middle: 44, ring: 88, pinky: 58 }),
  pinky: rawFromPercent({ thumb: 8, index: 8, middle: 12, ring: 66, pinky: 88 })
};

const profiles = buildFingerTapProfiles(open, fist, calibratedFingerTaps);

function stableTap(frame: FingerBends, at = 1000) {
  const first = detectFingerTapsFromBends(frame, initialFingerTapDetectorState(), at, profiles);
  return detectFingerTapsFromBends(frame, first.state, at + 40, profiles);
}

describe("Finger Tap glove detection", () => {
  it("detects pinky by comparing pinky movement to its calibrated factor", () => {
    const result = stableTap({ thumb: 8, index: 8, middle: 12, ring: 68, pinky: 88 });
    expect(result.taps).toHaveLength(1);
    expect(result.taps[0].finger).toBe("pinky");
  });

  it("detects ring when ring has the strongest calibrated movement factor", () => {
    const result = stableTap({ thumb: 8, index: 10, middle: 45, ring: 88, pinky: 58 });
    expect(result.taps).toHaveLength(1);
    expect(result.taps[0].finger).toBe("ring");
  });

  it("detects middle by its own calibrated factor", () => {
    const result = stableTap({ thumb: 8, index: 26, middle: 90, ring: 35, pinky: 12 });
    expect(result.taps).toHaveLength(1);
    expect(result.taps[0].finger).toBe("middle");
  });

  it("rejects ambiguous calibrated factors", () => {
    const result = stableTap({ thumb: 8, index: 8, middle: 24, ring: 78, pinky: 78 });
    expect(result.taps).toHaveLength(0);
  });

  it("does not double count a held calibrated factor until release", () => {
    const frame = { thumb: 8, index: 8, middle: 12, ring: 68, pinky: 88 };
    const firstCandidate = detectFingerTapsFromBends(frame, initialFingerTapDetectorState(), 1000, profiles);
    const first = detectFingerTapsFromBends(frame, firstCandidate.state, 1040, profiles);
    const held = detectFingerTapsFromBends(frame, first.state, 1400, profiles);
    expect(first.taps).toHaveLength(1);
    expect(held.taps).toHaveLength(0);

    const released = detectFingerTapsFromBends(bends(12), held.state, 1500, profiles);
    const secondCandidate = detectFingerTapsFromBends(frame, released.state, 1800, profiles);
    const second = detectFingerTapsFromBends(frame, secondCandidate.state, 1840, profiles);
    expect(second.taps).toHaveLength(1);
  });

  it("detects taps from calibrated raw values", () => {
    const rawFrame = rawFromPercent({ thumb: 8, index: 8, middle: 12, ring: 68, pinky: 88 });
    const first = detectFingerTapsFromRaw(rawFrame as unknown as Record<string, number>, open, fist, initialFingerTapDetectorState(), 1000, profiles);
    const result = detectFingerTapsFromRaw(rawFrame as unknown as Record<string, number>, open, fist, first.state, 1040, profiles);
    expect(result.bends.pinky).toBe(88);
    expect(result.taps[0].finger).toBe("pinky");
  });

  it("fails calibration quality for noisy or weak finger captures", () => {
    const weak = assessFingerTapCaptureQuality({
      finger: "index",
      samples: Array.from({ length: 8 }, () => rawFromPercent({ thumb: 6, index: 16, middle: 8, ring: 6, pinky: 6 }) as unknown as Record<string, number>),
      averaged: rawFromPercent({ thumb: 6, index: 16, middle: 8, ring: 6, pinky: 6 }),
      open,
      closed: fist,
      existingFingerTaps: {}
    });
    expect(weak.ok).toBe(false);
    expect(weak.status).toBe("weak-signal");

    const noisySamples = Array.from(
      { length: 8 },
      (_, i) => rawFromPercent({ thumb: 8, index: i % 2 ? 92 : 42, middle: 20, ring: 8, pinky: 8 }) as unknown as Record<string, number>
    );
    const noisy = assessFingerTapCaptureQuality({
      finger: "index",
      samples: noisySamples,
      averaged: rawFromPercent({ thumb: 8, index: 72, middle: 20, ring: 8, pinky: 8 }),
      open,
      closed: fist,
      existingFingerTaps: {}
    });
    expect(noisy.ok).toBe(false);
    expect(noisy.status).toBe("too-noisy");
  });
});
