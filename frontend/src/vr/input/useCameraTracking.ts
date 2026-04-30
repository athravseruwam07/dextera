import { useCallback, useEffect, useRef, useState } from "react";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// Landmark 9 = middle finger MCP — stable palm proxy
const PALM_LANDMARK = 9;

export type CameraLandmark = { x: number; y: number };

// onPosition receives raw MediaPipe coords: x in [0,1] (camera frame), y in [0,1].
// x is NOT yet mirrored — caller decides how to map to game coords.
export function useCameraTracking(onPosition: (x: number, y: number) => void) {
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [landmark, setLandmark] = useState<CameraLandmark | null>(null);

  const landmarkerRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);
  // Always use the latest callback without restarting the RAF loop
  const onPositionRef = useRef(onPosition);
  useEffect(() => { onPositionRef.current = onPosition; }, [onPosition]);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current as {
      detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: { x: number; y: number }[][] };
    } | null;

    if (video && landmarker && video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, performance.now());
      if (result.landmarks?.length) {
        const lm = result.landmarks[0][PALM_LANDMARK];
        setLandmark({ x: lm.x, y: lm.y });
        onPositionRef.current(lm.x, lm.y);
      } else {
        setLandmark(null);
      }
    }

    if (activeRef.current) {
      rafRef.current = requestAnimationFrame(runLoop);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (activeRef.current || isLoading) return;
    setIsLoading(true);
    setError(null);

    // Invisible video element attached to body — MediaPipe needs it in the DOM
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    Object.assign(video.style, {
      position: "fixed",
      opacity: "0",
      pointerEvents: "none",
      width: "1px",
      height: "1px",
      top: "0",
      left: "0",
    });
    document.body.appendChild(video);
    videoRef.current = video;

    try {
      const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
      landmarkerRef.current = landmarker;

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      video.srcObject = mediaStream;
      await video.play();

      activeRef.current = true;
      setIsActive(true);
      setIsLoading(false);
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (err) {
      video.remove();
      videoRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
    }
  }, [isLoading, runLoop]);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    (landmarkerRef.current as { close?(): void } | null)?.close?.();
    videoRef.current?.remove();
    streamRef.current = null;
    landmarkerRef.current = null;
    videoRef.current = null;
    setIsActive(false);
    setStream(null);
    setLandmark(null);
    setError(null);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return { isActive, isLoading, error, startCamera, stopCamera, stream, landmark };
}
