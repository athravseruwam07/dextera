import { describe, expect, it } from "vitest";
import {
  classifyGesture,
  gestureTargets,
  scoreAccuracy,
  summarizePatient
} from "./gesture";
import type { Patient, RehabSession } from "../types";

describe("gesture utilities", () => {
  it("classifies the core glove gestures", () => {
    expect(classifyGesture(gestureTargets.open)).toBe("open");
    expect(classifyGesture(gestureTargets.fist)).toBe("fist");
    expect(classifyGesture(gestureTargets.point)).toBe("point");
    expect(classifyGesture(gestureTargets.pinch)).toBe("pinch");
  });

  it("scores exact target bends as high accuracy", () => {
    expect(scoreAccuracy(gestureTargets.fist, "fist")).toBe(100);
  });

  it("summarizes patient sessions", () => {
    const session: RehabSession = {
      id: "s1",
      patientId: "p1",
      exerciseId: "e1",
      exerciseName: "Ball pickup",
      startedAt: "2026-04-27T20:00:00Z",
      endedAt: "2026-04-27T20:10:00Z",
      repsCompleted: 12,
      targetReps: 15,
      averageAccuracy: 88,
      bestFistScore: 94,
      fatigueWarnings: 1,
      notes: "Good control",
      events: [
        {
          id: "g1",
          patientId: "p1",
          gesture: "open",
          timestamp: "2026-04-27T20:00:01Z",
          accuracy: 91,
          holdMs: 700,
          smoothness: 82,
          ...gestureTargets.open
        },
        {
          id: "g2",
          patientId: "p1",
          gesture: "fist",
          timestamp: "2026-04-27T20:00:03Z",
          accuracy: 94,
          holdMs: 900,
          smoothness: 80,
          ...gestureTargets.fist
        }
      ]
    };
    const patient: Patient = {
      id: "p1",
      name: "Avery",
      age: 45,
      diagnosis: "Post-stroke hand therapy",
      therapist: "Dr. Lee",
      status: "active",
      goal: "Improve fist range",
      baselineMobility: 30,
      sessions: [session]
    };

    expect(summarizePatient(patient)).toMatchObject({
      totalSessions: 1,
      repsCompleted: 12,
      bestFistScore: 94
    });
  });
});
