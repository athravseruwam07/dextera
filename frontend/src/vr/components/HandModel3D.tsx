import { Environment, useGLTF } from "@react-three/drei";
import { useFrame, useGraph } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Bone, Group, MathUtils, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FingerBends, FingerName } from "../../types";

const MODEL_URL = "/models/realistic-hand.glb";

const CLOSED_POSE: Record<string, [number, number, number, number]> = {
  HandMain: [0.369, -0.1936, -0.2033, 0.886],
  Bone001: [-0.6075, 0.0558, 0.0635, 0.7898],
  Bone002: [0.3951, 0.3939, 0.5152, 0.6506],
  Bone003: [-0.0142, 0.002, 0.2189, 0.9756],
  IndexRoot: [-0.1824, -0.0061, -0.0889, 0.9792],
  IndexF_lower: [-0.0278, -0.1332, 0.6671, 0.7324],
  IndexF_middle: [0.011, -0.0239, 0.7547, 0.6555],
  IndexF_tip: [-0.003, 0.0011, 0.4501, 0.893],
  MiddleF_lower: [-0.0805, -0.0221, 0.7187, 0.6903],
  MiddleF_middle: [0.0078, -0.0138, 0.7768, 0.6295],
  MiddleF_tip: [0.0065, -0.0003, 0.4113, 0.9115],
  RingRoot: [0.1277, -0.0198, -0.1194, 0.9844],
  RingF_lower: [-0.0352, 0.01, 0.7558, 0.6538],
  RingF_middle: [0.0062, -0.0066, 0.588, 0.8088],
  RingF_tip: [0.0028, 0.0046, 0.6707, 0.7417],
  PinkyRoot: [0.2665, 0.0201, -0.0498, 0.9623],
  PinkyF_lower: [-0.1389, -0.0114, 0.7281, 0.6711],
  PinkyF_middle: [-0.0191, 0.0237, 0.6467, 0.7621],
  PinkyF_tip: [0.0637, -0.0657, 0.6465, 0.7574]
};

const BONE_GROUPS: Record<FingerName, string[]> = {
  thumb: ["Bone001", "Bone002", "Bone003"],
  index: ["IndexRoot", "IndexF_lower", "IndexF_middle", "IndexF_tip"],
  middle: ["MiddleF_lower", "MiddleF_middle", "MiddleF_tip"],
  ring: ["RingF_lower", "RingF_middle", "RingF_tip"],
  pinky: ["PinkyRoot", "PinkyF_lower", "PinkyF_middle", "PinkyF_tip"]
};

const TMP_QUATERNION = new Quaternion();
const TARGET_QUATERNION = new Quaternion();

type GraphNode = Object3D & {
  geometry?: SkinnedMesh["geometry"];
  material?: MeshStandardMaterial;
  skeleton?: SkinnedMesh["skeleton"];
};

export type HandPreviewTransform = {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  scale: number;
};

export function HandModel3D({
  bends,
  transform
}: {
  bends: FingerBends;
  transform?: HandPreviewTransform;
}) {
  const { scene } = useGLTF(MODEL_URL);
  const clonedScene = useMemo(() => clone(scene), [scene]);
  const { nodes } = useGraph(clonedScene);
  const rigRef = useRef<Group>(null);

  const bones = useMemo(() => {
    const mapped = new Map<string, Bone>();

    Object.entries(nodes).forEach(([name, node]) => {
      if (node instanceof Bone) {
        mapped.set(name, node);
      }
    });

    return mapped;
  }, [nodes]);

  const handMesh = (nodes.hooded_char_LP as GraphNode | undefined) ?? null;
  const handMain = (nodes.HandMain as Bone | undefined) ?? null;

  const basePose = useMemo(() => {
    const mapped = new Map<string, Quaternion>();
    bones.forEach((bone, name) => mapped.set(name, bone.quaternion.clone()));
    return mapped;
  }, [bones]);

  const closedPose = useMemo(() => {
    const mapped = new Map<string, Quaternion>();
    Object.entries(CLOSED_POSE).forEach(([name, values]) => {
      mapped.set(name, new Quaternion().fromArray(values));
    });
    return mapped;
  }, []);

  useLayoutEffect(() => {
    bones.forEach((bone, name) => {
      const base = basePose.get(name);
      if (base) bone.quaternion.copy(base);
    });
  }, [basePose, bones]);

  useFrame(() => {
    if (!rigRef.current) return;

    const averageCurl = MathUtils.clamp(
      (bends.thumb + bends.index + bends.middle + bends.ring + bends.pinky) / 500,
      0,
      1
    );

    const palmBase = basePose.get("HandMain");
    const palmClosed = closedPose.get("HandMain");
    if (handMain && palmBase && palmClosed) {
      TARGET_QUATERNION.copy(palmBase).slerp(palmClosed, averageCurl);
      handMain.quaternion.slerp(TARGET_QUATERNION, 0.25);
    }

    (Object.keys(BONE_GROUPS) as FingerName[]).forEach((finger) => {
      const ratio = MathUtils.clamp(bends[finger] / 100, 0, 1);
      for (const boneName of BONE_GROUPS[finger]) {
        const bone = bones.get(boneName);
        const base = basePose.get(boneName);
        const closed = closedPose.get(boneName);
        if (!bone || !base || !closed) continue;
        TMP_QUATERNION.copy(base).slerp(closed, ratio);
        bone.quaternion.slerp(TMP_QUATERNION, 0.3);
      }
    });

    rigRef.current.rotation.x = transform?.rotationX ?? 3.14;
    rigRef.current.rotation.y = transform?.rotationY ?? 1.17;
    rigRef.current.rotation.z = transform?.rotationZ ?? -1.64;
  });

  if (!handMesh?.geometry || !handMesh.skeleton || !handMain) return null;

  const material = handMesh.material instanceof MeshStandardMaterial
    ? handMesh.material
    : new MeshStandardMaterial({ color: "#d2b19a" });

  material.roughness = 0.62;
  material.metalness = 0;
  material.envMapIntensity = 0.95;

  return (
    <group
      ref={rigRef}
      position={[transform?.positionX ?? 0, transform?.positionY ?? -0.1, transform?.positionZ ?? 0]}
      scale={[-(transform?.scale ?? 0.5), transform?.scale ?? 0.5, transform?.scale ?? 0.5]}
    >
      <Environment preset="studio" />
      <group name="Root_Scene">
        <group
          name="Armature"
          position={[1.166, 0.123, 0]}
          rotation={[Math.PI / 2, -1.484, -Math.PI]}
          scale={100}
        >
          <primitive object={handMain} />
        </group>
        <skinnedMesh
          geometry={handMesh.geometry}
          material={material}
          skeleton={handMesh.skeleton}
          position={[-0.005, 0.054, -0.009]}
          scale={380}
          castShadow
          receiveShadow
        />
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
