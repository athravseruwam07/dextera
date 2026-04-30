import { RefObject, useEffect, useRef } from "react";
import { useGameStore } from "../state/gameStore";
import { createVrGestureEvent } from "../types/gesture";

const xRange = 4.2;
const zRange = 3.2;
const depthStep = 0.18;

export function useHandControls(
  stageRef: RefObject<HTMLElement>,
  { positionEnabled = true, gestureEnabled = true } = {}
) {
  const setHandPosition = useGameStore((state) => state.setHandPosition);
  const setGestureEvent = useGameStore((state) => state.setGestureEvent);
  const pointer = useRef({ x: 0, z: 0 });
  const depthOffset = useRef(0);

  useEffect(() => {
    function commitPosition() {
      const z = Math.max(-2.8, Math.min(2.6, pointer.current.z + depthOffset.current));
      setHandPosition([pointer.current.x, 0.78, z]);
    }

    function onPointerMove(event: PointerEvent) {
      if (!positionEnabled) return;
      const bounds = stageRef.current?.getBoundingClientRect();
      const width = bounds?.width ?? window.innerWidth;
      const height = bounds?.height ?? window.innerHeight;
      const left = bounds?.left ?? 0;
      const top = bounds?.top ?? 0;
      const normalizedX = Math.max(0, Math.min(1, (event.clientX - left) / width));
      const normalizedY = Math.max(0, Math.min(1, (event.clientY - top) / height));

      pointer.current = {
        x: (normalizedX - 0.5) * xRange * 2,
        z: (normalizedY - 0.52) * zRange * 2
      };
      commitPosition();
    }

    function onPointerDown(event: PointerEvent) {
      if (!gestureEnabled) return;
      if (event.button !== 0) return;
      onPointerMove(event);

      const stage = stageRef.current;
      stage?.setPointerCapture(event.pointerId);

      const state = useGameStore.getState();
      setGestureEvent(createVrGestureEvent("fist", state.patientId));
      state.selectNearestBall(0.95);
      state.grabSelectedBall();
      event.preventDefault();
    }

    function onPointerUp(event: PointerEvent) {
      if (!gestureEnabled) return;
      onPointerMove(event);

      const stage = stageRef.current;
      if (stage?.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }

      const state = useGameStore.getState();
      setGestureEvent(createVrGestureEvent("open", state.patientId));
      useGameStore.getState().releaseHeldBall();
    }

    function onKeyDown(event: KeyboardEvent) {
      const slow = event.shiftKey ? 0.45 : 1;

      if (event.key === "w" || event.key === "ArrowUp") {
        depthOffset.current -= depthStep * slow;
      } else if (event.key === "s" || event.key === "ArrowDown") {
        depthOffset.current += depthStep * slow;
      } else {
        return;
      }

      event.preventDefault();
      commitPosition();
    }

    const stage = stageRef.current;
    if (stage) {
      stage.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerdown", onPointerDown);
    } else {
      window.addEventListener("pointermove", onPointerMove);
    }
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    commitPosition();

    return () => {
      if (stage) {
        stage.removeEventListener("pointermove", onPointerMove);
        stage.removeEventListener("pointerdown", onPointerDown);
      } else {
        window.removeEventListener("pointermove", onPointerMove);
      }
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [setGestureEvent, setHandPosition, stageRef, positionEnabled, gestureEnabled]);
}
