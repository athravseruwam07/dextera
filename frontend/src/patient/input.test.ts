import { describe, expect, it } from "vitest";
import type { CalibrationData, FingerBends } from "../types";
import { calibratedBendsFromRaw } from "./ballPickupGrip";
import { classifyWithCapturedShapes } from "./input";

const bends = (value: number): FingerBends => ({
  thumb: value,
  index: value,
  middle: value,
  ring: value,
  pinky: value
});

describe("patient input gesture classification", () => {
  it("uses captured point and pinch shapes instead of generic thresholds", () => {
    const open = bends(200);
    const fist = bends(800);
    const steps: CalibrationData["steps"] = {
      open,
      fist,
      point: { thumb: 520, index: 250, middle: 700, ring: 690, pinky: 670 },
      pinch: { thumb: 640, index: 620, middle: 260, ring: 250, pinky: 245 }
    };

    const calibratedPoint = calibratedBendsFromRaw({ ...steps.point! }, open, fist);
    const calibratedPinch = calibratedBendsFromRaw({ ...steps.pinch! }, open, fist);

    expect(classifyWithCapturedShapes(calibratedPoint, steps, open, fist)).toBe("point");
    expect(classifyWithCapturedShapes(calibratedPinch, steps, open, fist)).toBe("pinch");
  });
});
