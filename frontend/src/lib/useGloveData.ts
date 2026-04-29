import { useEffect, useState } from "react";
import type { FingerBends, GestureName } from "../types";
import { connectGestureStream, fetchLatestGloveEvent } from "./backend";

export type GloveData = {
  normalized: FingerBends | null;
  rawValues: Record<string, number> | null;
  gesture: GestureName;
  connected: boolean;
  lastUpdated: string | null;
};

type UseGloveDataOptions = {
  hardwareOnly?: boolean;
};

const defaultGloveData: GloveData = {
  normalized: null,
  rawValues: null,
  gesture: "open",
  connected: false,
  lastUpdated: null
};

export function useGloveData(patientId: string, options?: UseGloveDataOptions): GloveData {
  const [state, setState] = useState<GloveData>(defaultGloveData);

  useEffect(() => {
    if (options?.hardwareOnly) {
      let cancelled = false;

      const applyEvent = (event: {
        patientId: string;
        thumb: number;
        index: number;
        middle: number;
        ring: number;
        pinky: number;
        gesture: GestureName;
        timestamp: string;
        rawValues?: Record<string, number>;
      }) => {
        if (cancelled || !event.rawValues || event.patientId !== patientId) return;
        const normalized: FingerBends = {
          thumb: event.thumb,
          index: event.index,
          middle: event.middle,
          ring: event.ring,
          pinky: event.pinky
        };

        setState({
          normalized,
          rawValues: event.rawValues,
          gesture: event.gesture,
          connected: true,
          lastUpdated: event.timestamp
        });
      };

      const cleanup = connectGestureStream(patientId, applyEvent);

      const poll = window.setInterval(async () => {
        const latest = await fetchLatestGloveEvent();
        if (cancelled || !latest || latest.patientId !== patientId || !latest.rawValues) return;
        applyEvent(latest);
      }, 450);

      const watchdog = window.setInterval(() => {
        setState((previous) => {
          if (!previous.lastUpdated) return { ...previous, connected: false };
          const ageMs = Date.now() - new Date(previous.lastUpdated).getTime();
          return ageMs > 1800 ? { ...previous, connected: false } : previous;
        });
      }, 500);

      return () => {
        cancelled = true;
        cleanup();
        window.clearInterval(poll);
        window.clearInterval(watchdog);
      };
    }

    const cleanup = connectGestureStream(
      patientId,
      (event) => {
        const normalized: FingerBends = {
          thumb: event.thumb,
          index: event.index,
          middle: event.middle,
          ring: event.ring,
          pinky: event.pinky
        };
        setState({
          normalized,
          rawValues: event.rawValues ?? null,
          gesture: event.gesture,
          connected: true,
          lastUpdated: event.timestamp
        });
      },
      (connected) => setState((prev) => ({ ...prev, connected }))
    );

    return cleanup;
  }, [options?.hardwareOnly, patientId]);

  return state;
}
