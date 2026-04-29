import { useEffect } from "react";
import { useGameStore } from "../state/gameStore";
import { createVrGestureEvent, type VrGestureName } from "../types/gesture";

const keyToGesture: Record<string, VrGestureName> = {
  "1": "open",
  "2": "fist",
  "3": "point",
  "4": "pinch"
};

export function useKeyboardGestureControls() {
  const setGestureEvent = useGameStore((state) => state.setGestureEvent);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const gesture = keyToGesture[event.key];
      if (!gesture) return;

      event.preventDefault();
      const patientId = useGameStore.getState().patientId;
      setGestureEvent(createVrGestureEvent(gesture, patientId));
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setGestureEvent]);
}
