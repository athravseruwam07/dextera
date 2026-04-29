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
import { fingerNames, gestureLabels, gestureTargets, scoreAccuracy } from "../lib/gesture";
import type { FingerBends, FingerName, GestureEvent, GestureName, HandPosition, InputMode } from "../types";

const modeLabels: Record<InputMode, string> = {
  glove: "Smart Glove"
};

type PatientInputContextValue = {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  currentGesture: GestureName;
  fingerBends: FingerBends;
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

export function PatientInputProvider({
  children,
  patientId,
  smartGloveEvent,
  sessionId,
  slowMode = false
}: {
  children: ReactNode;
  patientId: string;
  smartGloveEvent?: GestureEvent;
  sessionId?: string;
  slowMode?: boolean;
}) {
  const [inputMode, setInputModeState] = useState<InputMode>(() => loadInputMode());
  const [fingerBends, setFingerBends] = useState<FingerBends>(gestureTargets.open);
  const [currentGesture, setCurrentGesture] = useState<GestureName>("open");
  const [handPosition, setHandPositionState] = useState<HandPosition>({ x: 24, y: 58, z: 0 });
  const [events, setEvents] = useState<GestureEvent[]>([]);
  const demoIndexRef = useRef(0);
  const lastSmartGloveAtRef = useRef(0);

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

  useEffect(() => {
    if (inputMode !== "glove" || !smartGloveEvent || smartGloveEvent.patientId !== patientId) return;
    lastSmartGloveAtRef.current = Date.now();
    setCurrentGesture(smartGloveEvent.gesture);
    setFingerBends({
      thumb: smartGloveEvent.thumb,
      index: smartGloveEvent.index,
      middle: smartGloveEvent.middle,
      ring: smartGloveEvent.ring,
      pinky: smartGloveEvent.pinky
    });
    setEvents((items) => [smartGloveEvent, ...items].slice(0, 180));
  }, [inputMode, patientId, smartGloveEvent]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        if (Date.now() - lastSmartGloveAtRef.current < 2500) return;
        const item = demoPath[demoIndexRef.current % demoPath.length];
        demoIndexRef.current += 1;
        emitGesture(item.gesture, gestureTargets[item.gesture], item.position);
      },
      slowMode ? 1400 : 900
    );

    return () => window.clearInterval(interval);
  }, [emitGesture, slowMode]);

  const value = useMemo(
    () => ({
      inputMode,
      setInputMode,
      currentGesture,
      fingerBends,
      handPosition,
      events,
      emitGesture,
      setHandPosition
    }),
    [currentGesture, emitGesture, events, fingerBends, handPosition, inputMode, setHandPosition, setInputMode]
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
