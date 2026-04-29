import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { useGameStore } from "../state/gameStore";
import { createVrGestureEvent, type VrGestureName } from "../types/gesture";

const fingers = ["thumb", "index", "middle", "ring", "pinky"] as const;
const gestureControls: VrGestureName[] = ["open", "fist", "point", "pinch"];

export function SessionHud({ patientName }: { patientName: string }) {
  const gestureEvent = useGameStore((state) => state.gestureEvent);
  const selectedBallId = useGameStore((state) => state.selectedBallId);
  const heldBallId = useGameStore((state) => state.heldBallId);
  const repsCompleted = useGameStore((state) => state.repsCompleted);
  const attempts = useGameStore((state) => state.attempts);
  const lastResult = useGameStore((state) => state.lastResult);
  const resetSession = useGameStore((state) => state.resetSession);
  const sessionId = useGameStore((state) => state.sessionId);
  const setGestureEvent = useGameStore((state) => state.setGestureEvent);

  const accuracy = useMemo(() => {
    if (attempts === 0) return 0;
    return Math.round((repsCompleted / attempts) * 100);
  }, [attempts, repsCompleted]);

  const setGesture = (gesture: VrGestureName) => {
    setGestureEvent(createVrGestureEvent(gesture, gestureEvent.patientId));
  };

  return (
    <aside className="vr-session-hud" aria-label="Session status">
      <div className="vr-hud-header">
        <div>
          <span className="eyebrow">Ball pickup exercise</span>
          <h2>VR Rehab Game</h2>
          <p>{patientName}</p>
        </div>
        <button className="secondary-button" type="button" onClick={resetSession}>
          <RotateCcw size={17} />
          Reset
        </button>
      </div>

      <div className="vr-hud-metrics">
        <div>
          <span>Gesture</span>
          <strong>{gestureEvent.gesture}</strong>
        </div>
        <div>
          <span>Reps</span>
          <strong>{repsCompleted}</strong>
        </div>
        <div>
          <span>Accuracy</span>
          <strong>{accuracy}%</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{lastResult}</strong>
        </div>
      </div>

      <div className="vr-gesture-controls" aria-label="Gesture controls">
        {gestureControls.map((gesture) => (
          <button
            className={`vr-gesture-button ${gestureEvent.gesture === gesture ? "is-active" : ""}`}
            key={gesture}
            type="button"
            onClick={() => setGesture(gesture)}
          >
            {gesture}
          </button>
        ))}
      </div>

      <div className="vr-finger-panel">
        {fingers.map((finger) => (
          <div className="vr-finger-row" key={finger}>
            <span>{finger}</span>
            <div className="vr-bar-track">
              <div style={{ width: `${gestureEvent[finger]}%` }} />
            </div>
            <b>{gestureEvent[finger]}%</b>
          </div>
        ))}
      </div>

      <div className="vr-debug-panel">
        <div>
          <span>Selected</span>
          <strong>{selectedBallId ?? "none"}</strong>
        </div>
        <div>
          <span>Held</span>
          <strong>{heldBallId ?? "none"}</strong>
        </div>
        <div>
          <span>Session</span>
          <strong>{sessionId}</strong>
        </div>
      </div>
    </aside>
  );
}
