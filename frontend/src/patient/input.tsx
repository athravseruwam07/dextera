import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { classifyGesture, gestureLabels, gestureTargets, scoreAccuracy } from "../lib/gesture";
import { fetchLatestGloveEvent } from "../lib/backend";
import type { CalibrationData, FingerBends, FingerName, GestureEvent, GestureName, HandPosition, InputMode } from "../types";
import {
  calibratedBendsFromRaw,
  classifyGripFrame,
  initialGripClassifierState
} from "./ballPickupGrip";
import {
  detectFingerTapsFromBends,
  detectFingerTapsFromRaw,
  initialFingerTapDetectorState
} from "./fingerTapInput";

const modeLabels: Record<InputMode, string> = {
  glove: "Smart Glove"
};

export type PatientGloveMode = "default" | "raw" | "ball-pickup" | "finger-tap";

type PatientInputContextValue = {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  currentGesture: GestureName;
  fingerBends: FingerBends;
  rawValues: Record<string, number> | null;
  rawSamples: Array<Record<string, number>>;
  rawConnected: boolean;
  lastRawAt: number;
  handPosition: HandPosition;
  events: GestureEvent[];
  emitGesture: (gesture: GestureName, bends?: FingerBends, position?: HandPosition) => GestureEvent;
  setHandPosition: (position: HandPosition) => void;
};

const PatientInputContext = createContext<PatientInputContextValue | null>(null);

function loadInputMode(): InputMode {
  return "glove";
}

function storeInputMode(_mode: InputMode) {}

function clampPosition(position: HandPosition): HandPosition {
  return {
    x: Math.max(0, Math.min(100, Math.round(position.x))),
    y: Math.max(0, Math.min(100, Math.round(position.y))),
    z: Math.max(-100, Math.min(100, Math.round(position.z)))
  };
}

function tapBends(finger: FingerName): FingerBends {
  return {
    thumb: finger === "thumb" ? 82 : 12,
    index: finger === "index" ? 86 : 16,
    middle: finger === "middle" ? 86 : 14,
    ring: finger === "ring" ? 84 : 13,
    pinky: finger === "pinky" ? 82 : 12
  };
}

function createInputEvent(
  patientId: string,
  gesture: GestureName,
  bends: FingerBends,
  sessionId?: string
): GestureEvent {
  return {
    id: `patient-input-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    patientId,
    sessionId,
    gesture,
    timestamp: new Date().toISOString(),
    accuracy: scoreAccuracy(bends, gesture),
    holdMs: 500 + Math.round(Math.random() * 1300),
    smoothness: 72 + Math.round(Math.random() * 22),
    ...bends
  };
}

const demoPath: Array<{ gesture: GestureName; position: HandPosition }> = [
  { gesture: "open", position: { x: 20, y: 58, z: 0 } },
  { gesture: "point", position: { x: 27, y: 56, z: 0 } },
  { gesture: "fist", position: { x: 27, y: 56, z: 0 } },
  { gesture: "open", position: { x: 82, y: 45, z: 0 } },
  { gesture: "pinch", position: { x: 48, y: 42, z: 0 } },
  { gesture: "tap_thumb", position: { x: 50, y: 70, z: 0 } },
  { gesture: "tap_index", position: { x: 50, y: 70, z: 0 } },
  { gesture: "tap_middle", position: { x: 50, y: 70, z: 0 } },
  { gesture: "tap_ring", position: { x: 50, y: 70, z: 0 } },
  { gesture: "tap_pinky", position: { x: 50, y: 70, z: 0 } },
  { gesture: "flick", position: { x: 52, y: 22, z: 0 } }
];

export function classifyWithCapturedShapes(
  bends: FingerBends,
  steps: CalibrationData["steps"] | undefined,
  open: FingerBends,
  fist: FingerBends
): GestureName {
  const candidates: Array<{ gesture: GestureName; bends: FingerBends }> = [
    { gesture: "open", bends: calibratedBendsFromRaw({ ...open }, open, fist) },
    { gesture: "fist", bends: calibratedBendsFromRaw({ ...fist }, open, fist) }
  ];

  if (steps?.point) {
    candidates.push({ gesture: "point", bends: calibratedBendsFromRaw({ ...steps.point }, open, fist) });
  }
  if (steps?.pinch) {
    candidates.push({ gesture: "pinch", bends: calibratedBendsFromRaw({ ...steps.pinch }, open, fist) });
  }

  const best = candidates
    .map((candidate) => ({
      gesture: candidate.gesture,
      distance:
        Math.abs(bends.thumb - candidate.bends.thumb) +
        Math.abs(bends.index - candidate.bends.index) +
        Math.abs(bends.middle - candidate.bends.middle) +
        Math.abs(bends.ring - candidate.bends.ring) +
        Math.abs(bends.pinky - candidate.bends.pinky)
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (best && best.distance <= 150) return best.gesture;
  return classifyGesture(bends);
}

export function PatientInputProvider({
  children,
  patientId,
  smartGloveEvent,
  calibration,
  openFistOnly = false,
  gloveMode,
  sessionId
}: {
  children: ReactNode;
  patientId: string;
  smartGloveEvent?: GestureEvent;
  calibration?: CalibrationData;
  openFistOnly?: boolean;
  gloveMode?: PatientGloveMode;
  sessionId?: string;
}) {
  const effectiveGloveMode: PatientGloveMode = gloveMode ?? (openFistOnly ? "ball-pickup" : "default");
  const [inputMode, setInputModeState] = useState<InputMode>(() => loadInputMode());
  const [fingerBends, setFingerBends] = useState<FingerBends>(gestureTargets.open);
  const [rawValues, setRawValues] = useState<Record<string, number> | null>(null);
  const [rawSamples, setRawSamples] = useState<Array<Record<string, number>>>([]);
  const [rawConnected, setRawConnected] = useState(false);
  const [lastRawAt, setLastRawAt] = useState(0);
  const [currentGesture, setCurrentGesture] = useState<GestureName>("open");
  const [handPosition, setHandPositionState] = useState<HandPosition>({ x: 24, y: 58, z: 0 });
  const [events, setEvents] = useState<GestureEvent[]>([]);
  const demoIndexRef = useRef(0);
  const lastSmartGloveAtRef = useRef(0);
  const gripStateRef = useRef(initialGripClassifierState);
  const fingerTapStateRef = useRef(initialFingerTapDetectorState());

  const setInputMode = useCallback((mode: InputMode) => {
    setInputModeState(mode);
    storeInputMode(mode);
  }, []);

  const setHandPosition = useCallback((position: HandPosition) => {
    setHandPositionState(clampPosition(position));
  }, []);

  const emitGesture = useCallback(
    (gesture: GestureName, bends = gestureTargets[gesture], position?: HandPosition) => {
      const nextPosition = position ? clampPosition(position) : handPosition;
      const event = createInputEvent(patientId, gesture, bends, sessionId);
      setCurrentGesture(gesture);
      setFingerBends(bends);
      setHandPositionState(nextPosition);
      setEvents((items) => [event, ...items].slice(0, 180));
      return event;
    },
    [handPosition, patientId, sessionId]
  );

  const applyGloveEvent = useCallback((event: GestureEvent) => {
    const bridgePatientId = "demo-patient-1";
    const hardwareMode = effectiveGloveMode !== "default";
    const patientMatches = event.patientId === patientId || (hardwareMode && event.patientId === bridgePatientId);
    if (inputMode !== "glove" || !patientMatches) return;
    const hasRawValues = Boolean(event.rawValues);
    if (hardwareMode && !hasRawValues) return;

    const eventAt = new Date(event.timestamp).getTime();
    const receivedAt = Number.isNaN(eventAt) ? Date.now() : eventAt;
    lastSmartGloveAtRef.current = receivedAt;
    setRawValues(event.rawValues ?? null);
    if (event.rawValues) {
      setLastRawAt(receivedAt);
      setRawConnected(true);
      setRawSamples((items) => [event.rawValues as Record<string, number>, ...items].slice(0, 8));
    }
    const eventBends = {
      thumb: event.thumb,
      index: event.index,
      middle: event.middle,
      ring: event.ring,
      pinky: event.pinky
    };
    const open = calibration?.steps.open;
    const fist = calibration?.steps.fist;
    const hasRawCalibration = event.rawValues && open && fist;
    const calibratedRawValues = hasRawCalibration ? event.rawValues as Record<string, number> : null;
    const bends = hasRawCalibration
      ? calibratedBendsFromRaw(calibratedRawValues!, open, fist)
      : eventBends;
    let gesture: GestureName;
    let detectedTapEvents: GestureEvent[] = [];
    if (effectiveGloveMode === "ball-pickup") {
      const nextGrip = classifyGripFrame(bends, gripStateRef.current);
      gripStateRef.current = nextGrip.state;
      gesture = nextGrip.gesture;
    } else if (effectiveGloveMode === "finger-tap") {
      const timestamp = receivedAt;
      const profiles = calibration?.fingerTapProfiles;
      const detection =
        hasRawCalibration
          ? detectFingerTapsFromRaw(calibratedRawValues!, open, fist, fingerTapStateRef.current, timestamp, profiles)
          : detectFingerTapsFromBends(bends, fingerTapStateRef.current, timestamp, profiles);
      fingerTapStateRef.current = detection.state;
      gesture = event.rawValues && open && fist ? classifyGesture(bends) : event.gesture;
      detectedTapEvents = detection.taps.map((tap) => {
        const tapGesture = `tap_${tap.finger}` as GestureName;
        return {
          ...event,
          id: `${event.id}-tap-${tap.finger}-${tap.timestamp}`,
          gesture: tapGesture,
          timestamp: new Date(tap.timestamp).toISOString(),
          accuracy: Math.max(0, Math.min(100, Math.round(tap.confidence))),
          holdMs: 0,
          smoothness: Math.max(0, Math.min(100, Math.round(tap.strength))),
          ...tap.bends
        };
      });
    } else {
      gesture = event.rawValues && open && fist
        ? classifyWithCapturedShapes(bends, calibration?.steps, open, fist)
        : event.gesture;
    }
    const calibratedEvent = { ...event, ...bends, gesture };
    setCurrentGesture(gesture);
    setFingerBends(bends);
    setEvents((items) => [calibratedEvent, ...detectedTapEvents, ...items].slice(0, 180));
  }, [calibration?.fingerTapProfiles, calibration?.steps, calibration?.steps.fist, calibration?.steps.open, effectiveGloveMode, inputMode, patientId]);

  useEffect(() => {
    if (!smartGloveEvent) return;
    applyGloveEvent(smartGloveEvent);
  }, [applyGloveEvent, smartGloveEvent]);

  useEffect(() => {
    if (effectiveGloveMode === "default") return undefined;
    let cancelled = false;

    const pollLatestRaw = async () => {
      const event = await fetchLatestGloveEvent();
      if (!cancelled && event?.rawValues) {
        applyGloveEvent(event);
      }
    };

    void pollLatestRaw();
    const poll = window.setInterval(() => void pollLatestRaw(), 350);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [applyGloveEvent, effectiveGloveMode]);

  useEffect(() => {
    if (effectiveGloveMode !== "default") return undefined;
    const interval = window.setInterval(
      () => {
        if (Date.now() - lastSmartGloveAtRef.current < 2500) return;
        const item = demoPath[demoIndexRef.current % demoPath.length];
        demoIndexRef.current += 1;
        emitGesture(item.gesture, gestureTargets[item.gesture]);
      },
      900
    );

    return () => window.clearInterval(interval);
  }, [effectiveGloveMode, emitGesture]);

  useEffect(() => {
    if (effectiveGloveMode === "default") return undefined;
    const watchdog = window.setInterval(() => {
      setRawConnected((connected) => (connected && Date.now() - lastSmartGloveAtRef.current <= 1800 ? connected : false));
    }, 500);
    return () => window.clearInterval(watchdog);
  }, [effectiveGloveMode]);

  const value = useMemo(
    () => ({
      inputMode,
      setInputMode,
      currentGesture,
      fingerBends,
      rawValues,
      rawSamples,
      rawConnected,
      lastRawAt,
      handPosition,
      events,
      emitGesture,
      setHandPosition
    }),
    [currentGesture, emitGesture, events, fingerBends, handPosition, inputMode, lastRawAt, rawConnected, rawSamples, rawValues, setHandPosition, setInputMode]
  );

  return <PatientInputContext.Provider value={value}>{children}</PatientInputContext.Provider>;
}

export function usePatientInput() {
  const context = useContext(PatientInputContext);
  if (!context) {
    throw new Error("usePatientInput must be used inside PatientInputProvider");
  }
  return context;
}

export function ManualGestureControls() {
  const { currentGesture, emitGesture, handPosition } = usePatientInput();
  const gestures: GestureName[] = ["open", "point", "fist", "pinch", "tap_index", "flick"];

  return (
    <div className="manual-gesture-controls" aria-label="Manual gesture controls">
      {gestures.map((gesture) => (
        <button
          key={gesture}
          type="button"
          className={currentGesture === gesture ? "is-active" : ""}
          onClick={() => emitGesture(gesture, gestureTargets[gesture], handPosition)}
        >
          {gestureLabels[gesture]}
        </button>
      ))}
    </div>
  );
}

export function emitFingerTap(finger: FingerName, emitGesture: PatientInputContextValue["emitGesture"]) {
  const gesture = `tap_${finger}` as GestureName;
  return emitGesture(gesture, tapBends(finger));
}

export { modeLabels as inputModeLabels, tapBends };
