import { useCallback, useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/gameStore";

const X_RANGE = 4.2;
const Z_RANGE = 3.2;
const Y_FIXED = 0.78;
const Z_MIN = -2.8;
const Z_MAX = 2.6;
// Landmark 9 = middle finger MCP joint — stable palm proxy
const PALM_LANDMARK = 9;

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export function useMediaPipeHands() {
  const setHandPosition = useGameStore((s) => s.setHandPosition);
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current as {
      detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: { x: number; y: number }[][] };
    } | null;

    if (video && landmarker && video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, performance.now());
      if (result.landmarks?.length) {
        const lm = result.landmarks[0][PALM_LANDMARK];
        // Mirror X so moving hand right moves cursor right (selfie-cam)
        const gameX = (1 - lm.x - 0.5) * X_RANGE * 2;
        const gameZ = Math.max(Z_MIN, Math.min(Z_MAX, (lm.y - 0.52) * Z_RANGE * 2));
        setHandPosition([gameX, Y_FIXED, gameZ]);
      }
    }

    if (activeRef.current) {
      rafRef.current = requestAnimationFrame(runLoop);
    }
  }, [setHandPosition]);

  const startCamera = useCallback(async () => {
    if (activeRef.current || isLoading) return;
    setIsLoading(true);

    try {
      const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");

      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
      landmarkerRef.current = landmarker;

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      activeRef.current = true;
      setIsActive(true);
      setIsLoading(false);
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (err) {
      console.error("MediaPipe/camera init failed:", err);
      setIsLoading(false);
    }
  }, [isLoading, runLoop]);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    (landmarkerRef.current as { close?(): void } | null)?.close?.();
    streamRef.current = null;
    landmarkerRef.current = null;
    setIsActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return { isActive, isLoading, startCamera, stopCamera, videoRef };
}
