import { describe, expect, it } from "vitest";
import type { FingerBends } from "../types";
import {
  averageRawSamples,
  ballPickupGripAction,
  calibratedBendsFromRaw,
  classifyGripFrame,
  initialGripClassifierState
} from "./ballPickupGrip";

const bends = (value: number): FingerBends => ({
  thumb: value,
  index: value,
  middle: value,
  ring: value,
  pinky: value
});

const raw = (value: number): Record<string, number> => ({ ...bends(value) });

describe("Ball Pickup grip utilities", () => {
  it("maps raw glove values into calibrated bend percentages", () => {
    expect(calibratedBendsFromRaw(raw(1500), bends(1000), bends(2000))).toEqual(bends(50));
    expect(calibratedBendsFromRaw(raw(2400), bends(1000), bends(2000))).toEqual(bends(100));
    expect(calibratedBendsFromRaw(raw(700), bends(1000), bends(2000))).toEqual(bends(0));
  });

  it("averages raw calibration samples per finger", () => {
    expect(averageRawSamples([raw(1000), raw(1100), raw(1200)])).toEqual(bends(1100));
  });

  it("requires consecutive closed frames before committing fist", () => {
    const first = classifyGripFrame(bends(80), initialGripClassifierState);
    expect(first.gesture).toBe("open");
    expect(first.changed).toBe(false);

    const second = classifyGripFrame(bends(82), first.state);
    expect(second.gesture).toBe("fist");
    expect(second.changed).toBe(true);
  });

  it("uses release hysteresis so mid-range noise does not drop the ball", () => {
    const closed = classifyGripFrame(bends(82), classifyGripFrame(bends(80), initialGripClassifierState).state);
    const noisy = classifyGripFrame(bends(50), closed.state);
    expect(noisy.gesture).toBe("fist");
    expect(noisy.changed).toBe(false);

    const firstOpen = classifyGripFrame(bends(30), noisy.state);
    expect(firstOpen.gesture).toBe("fist");

    const secondOpen = classifyGripFrame(bends(28), firstOpen.state);
    expect(secondOpen.gesture).toBe("open");
    expect(secondOpen.changed).toBe(true);
  });

  it("returns one gameplay action per stable grip transition", () => {
    expect(ballPickupGripAction({ previousGrip: "open", nextGrip: "fist", canReachBall: true, held: false })).toBe("grab");
    expect(ballPickupGripAction({ previousGrip: "open", nextGrip: "fist", canReachBall: false, held: false })).toBe("closed-away");
    expect(ballPickupGripAction({ previousGrip: "fist", nextGrip: "open", canReachBall: true, held: true })).toBe("release");
    expect(ballPickupGripAction({ previousGrip: "fist", nextGrip: "fist", canReachBall: true, held: true })).toBe("none");
  });
});
