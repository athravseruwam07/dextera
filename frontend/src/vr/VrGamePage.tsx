import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { GestureEvent, Patient } from "../types";
import { RehabScene } from "./components/RehabScene";
import { SessionHud } from "./components/SessionHud";
import { InputOverlay } from "./components/InputOverlay";
import { useHandControls } from "./input/useHandControls";
import { useKeyboardGestureControls } from "./input/useKeyboardGestureControls";
import { useMediaPipeHands } from "./input/useMediaPipeHands";
import { useSerialGlove } from "./input/useSerialGlove";
import { useGameStore } from "./state/gameStore";

export function VrGamePage({ patient, currentEvent }: { patient: Patient; currentEvent: GestureEvent }) {
  const stageRef = useRef<HTMLElement>(null);
  const setPatientId = useGameStore((state) => state.setPatientId);
  const setGestureEvent = useGameStore((state) => state.setGestureEvent);

  const camera = useMediaPipeHands();
  const glove = useSerialGlove();

  useHandControls(stageRef, {
    positionEnabled: !camera.isActive,
    gestureEnabled: !glove.isConnected,
  });
  useKeyboardGestureControls();

  useEffect(() => {
    setPatientId(patient.id);
  }, [patient.id, setPatientId]);

  useEffect(() => {
    if (currentEvent.patientId !== patient.id) return;
    setGestureEvent({
      patientId: currentEvent.patientId,
      gesture: currentEvent.gesture,
      thumb: currentEvent.thumb,
      index: currentEvent.index,
      middle: currentEvent.middle,
      ring: currentEvent.ring,
      pinky: currentEvent.pinky,
      timestamp: currentEvent.timestamp
    });
  }, [currentEvent, patient.id, setGestureEvent]);

  return (
    <section className="vr-page">
      <section className="vr-stage" aria-label="VR-style rehab exercise" ref={stageRef}>
        <Canvas shadows gl={{ antialias: true, preserveDrawingBuffer: true }}>
          <RehabScene />
        </Canvas>
      </section>
      <SessionHud patientName={patient.name} />
      <InputOverlay glove={glove} camera={camera} />
    </section>
  );
}
