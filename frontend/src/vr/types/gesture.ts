import type { FingerBends, GestureName as DashboardGestureName } from "../../types";

export type VrGestureName = DashboardGestureName | "unknown";

export type VrGestureEvent = FingerBends & {
  patientId: string;
  gesture: VrGestureName;
  timestamp: string;
};

export const DEMO_PATIENT_ID = "demo-patient-1";

const fingerProfiles: Record<VrGestureName, FingerBends> = {
  open: { thumb: 8, index: 7, middle: 6, ring: 9, pinky: 10 },
  fist: { thumb: 86, index: 91, middle: 88, ring: 82, pinky: 78 },
  pinch: { thumb: 74, index: 68, middle: 18, ring: 16, pinky: 14 },
  point: { thumb: 45, index: 8, middle: 83, ring: 80, pinky: 76 },
  tap_thumb: { thumb: 86, index: 18, middle: 18, ring: 16, pinky: 15 },
  tap_index: { thumb: 18, index: 86, middle: 18, ring: 16, pinky: 15 },
  tap_middle: { thumb: 18, index: 18, middle: 86, ring: 16, pinky: 15 },
  tap_ring: { thumb: 18, index: 18, middle: 18, ring: 86, pinky: 15 },
  tap_pinky: { thumb: 18, index: 18, middle: 18, ring: 16, pinky: 86 },
  flick: { thumb: 36, index: 88, middle: 34, ring: 24, pinky: 22 },
  unknown: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }
};

export function createVrGestureEvent(
  gesture: VrGestureName,
  patientId = DEMO_PATIENT_ID
): VrGestureEvent {
  return {
    patientId,
    gesture,
    ...fingerProfiles[gesture],
    timestamp: new Date().toISOString()
  };
}
