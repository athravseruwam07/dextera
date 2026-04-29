import { Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Mesh, Vector3 } from "three";
import { useGameStore, type Ball } from "../state/gameStore";
import type { VrGestureName } from "../types/gesture";

const gestureSelectRadius: Record<VrGestureName, number> = {
  open: 0,
  fist: 0.85,
  pinch: 0.52,
  point: 0.92,
  tap_thumb: 0,
  tap_index: 0,
  tap_middle: 0,
  tap_ring: 0,
  tap_pinky: 0,
  flick: 0.68,
  unknown: 0
};

function GameRules() {
  const previousGesture = useRef<VrGestureName>("unknown");

  useFrame(() => {
    const state = useGameStore.getState();
    const gesture = state.gestureEvent.gesture;

    state.moveHeldBall();

    if (gesture === "fist" || gesture === "pinch") {
      state.selectNearestBall(gestureSelectRadius[gesture]);
      state.grabSelectedBall();
    } else if (gesture === "point") {
      state.selectNearestBall(gestureSelectRadius[gesture]);
    }

    if (gesture !== previousGesture.current) {
      if (gesture === "open") {
        state.releaseHeldBall();
      }

      previousGesture.current = gesture;
    }
  });

  return null;
}

function BallMesh({ ball }: { ball: Ball }) {
  const selectedBallId = useGameStore((state) => state.selectedBallId);
  const heldBallId = useGameStore((state) => state.heldBallId);
  const isSelected = selectedBallId === ball.id;
  const isHeld = heldBallId === ball.id;

  return (
    <mesh castShadow receiveShadow position={ball.position}>
      <sphereGeometry args={[isHeld ? 0.26 : 0.23, 32, 32]} />
      <meshStandardMaterial
        color={ball.color}
        emissive={isSelected || isHeld ? ball.color : "#000000"}
        emissiveIntensity={isHeld ? 0.35 : isSelected ? 0.2 : 0}
        roughness={0.42}
      />
    </mesh>
  );
}

function VirtualHand() {
  const meshRef = useRef<Mesh>(null);
  const handPosition = useGameStore((state) => state.handPosition);
  const gesture = useGameStore((state) => state.gestureEvent.gesture);
  const heldBallId = useGameStore((state) => state.heldBallId);

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.position.lerp(new Vector3(...handPosition), 0.42);
  });

  const color = gesture === "open" ? "#22c55e" : gesture === "fist" ? "#eab308" : "#38bdf8";

  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[heldBallId ? 0.2 : 0.16, 24, 24]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} />
    </mesh>
  );
}

function Basket() {
  return (
    <group position={[2.25, 0.22, -1.25]}>
      <mesh receiveShadow>
        <cylinderGeometry args={[0.82, 0.7, 0.38, 48, 1, true]} />
        <meshStandardMaterial color="#334155" roughness={0.7} transparent opacity={0.82} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow>
        <circleGeometry args={[0.68, 48]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <torusGeometry args={[0.78, 0.035, 10, 48]} />
        <meshStandardMaterial color="#1e293b" roughness={0.45} />
      </mesh>
    </group>
  );
}

function Table() {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.02, 0]}>
        <boxGeometry args={[7.6, 0.12, 5.2]} />
        <meshStandardMaterial color="#d7e0df" roughness={0.86} />
      </mesh>
      <Grid
        position={[0, 0.045, 0]}
        args={[7.6, 5.2]}
        cellSize={0.5}
        cellThickness={0.35}
        cellColor="#7c8a8d"
        sectionSize={1}
        sectionThickness={0.7}
        sectionColor="#475569"
        fadeDistance={7}
        fadeStrength={1}
      />
    </group>
  );
}

function SceneCamera() {
  const { size } = useThree();
  const isNarrow = size.width < 640 || size.width / size.height < 0.85;

  return (
    <PerspectiveCamera
      makeDefault
      position={isNarrow ? [0, 5.2, 8.8] : [0, 4.2, 6.5]}
      fov={isNarrow ? 66 : 48}
    />
  );
}

export function RehabScene() {
  const balls = useGameStore((state) => state.balls);

  return (
    <>
      <color attach="background" args={["#e8f0ee"]} />
      <SceneCamera />
      <ambientLight intensity={0.75} />
      <directionalLight
        castShadow
        position={[3.5, 6, 4]}
        intensity={1.65}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <GameRules />
      <Table />
      <Basket />
      {balls.map((ball) => (
        <BallMesh key={ball.id} ball={ball} />
      ))}
      <VirtualHand />
      <OrbitControls
        enablePan={false}
        enableRotate={false}
        enableDamping
        target={[0, 0, -0.35]}
        minDistance={4.2}
        maxDistance={8.5}
        maxPolarAngle={Math.PI / 2.25}
      />
    </>
  );
}
