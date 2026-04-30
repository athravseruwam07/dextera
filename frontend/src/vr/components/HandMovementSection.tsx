import { useCallback, useEffect, useRef, useState } from "react";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// Landmark 9 = middle finger MCP — stable palm proxy
const PALM_LANDMARK = 9;

type LandmarkPos = { x: number; y: number };

export function HandMovementSection() {
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [landmark, setLandmark] = useState<LandmarkPos | null>(null);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);
  const fpsRef = useRef({ frames: 0, lastAt: Date.now() });

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current as {
      detectForVideo(v: HTMLVideoElement, t: number): {
        landmarks?: { x: number; y: number }[][];
      };
    } | null;

    if (video && canvas && landmarker && video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d")!;
      // Draw mirrored video so it feels like a mirror
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      const result = landmarker.detectForVideo(video, performance.now());
      if (result.landmarks?.length) {
        const lm = result.landmarks[0][PALM_LANDMARK];
        // Mirror X to match the mirrored video
        const dotX = (1 - lm.x) * canvas.width;
        const dotY = lm.y * canvas.height;

        ctx.beginPath();
        ctx.arc(dotX, dotY, 12, 0, Math.PI * 2);
        ctx.fillStyle = "#00ff88";
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        setLandmark({ x: lm.x, y: lm.y });
      } else {
        setLandmark(null);
      }

      fpsRef.current.frames++;
      const now = Date.now();
      if (now - fpsRef.current.lastAt >= 1000) {
        setFps(fpsRef.current.frames);
        fpsRef.current = { frames: 0, lastAt: now };
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
    try {
      const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      const lm = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
      landmarkerRef.current = lm;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      activeRef.current = true;
      setIsActive(true);
      setIsLoading(false);
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
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
    setLandmark(null);
    setFps(0);

    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Map raw landmark to game-space coords (same formula as useMediaPipeHands)
  const gameX = landmark ? ((1 - landmark.x - 0.5) * 4.2 * 2).toFixed(2) : "—";
  const gameZ = landmark ? ((landmark.y - 0.52) * 3.2 * 2).toFixed(2) : "—";

  return (
    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start", marginTop: "1.5rem" }}>
      {/* Camera + canvas preview */}
      <div className="surface" style={{ padding: "1.25rem", flex: 2, minWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div className="section-title" style={{ margin: 0 }}>
            <h3>Hand Movement (Camera)</h3>
          </div>
          <button
            type="button"
            className={isActive ? "danger-button" : "primary-button"}
            onClick={isActive ? stopCamera : startCamera}
            disabled={isLoading}
            style={{ flexShrink: 0 }}
          >
            {isActive ? "Stop Camera" : isLoading ? "Starting…" : "Start Camera"}
          </button>
        </div>

        <div
          style={{
            position: "relative",
            borderRadius: 10,
            overflow: "hidden",
            background: "#0f172a",
            aspectRatio: "4/3",
          }}
        >
          {/* hidden real video — canvas renders the mirrored + annotated version */}
          <video ref={videoRef} muted playsInline style={{ display: "none" }} />
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
          />
          {!isActive && !isLoading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#475569",
                fontSize: "0.9rem",
              }}
            >
              Camera off — click Start Camera
            </div>
          )}
          {isLoading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#94a3b8",
                fontSize: "0.9rem",
              }}
            >
              Loading MediaPipe model…
            </div>
          )}
          {isActive && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(0,0,0,0.55)",
                color: "#94a3b8",
                fontSize: "0.72rem",
                padding: "2px 6px",
                borderRadius: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fps} fps
            </div>
          )}
        </div>

        {error && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#ef4444" }}>
            Error: {error}
          </p>
        )}

        <p style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--text-muted, #64748b)" }}>
          Green dot = landmark {PALM_LANDMARK} (middle finger MCP). Camera image is mirrored.
          Requires Chrome or Edge — not supported in Firefox.
        </p>
      </div>

      {/* Live numbers */}
      <div className="surface" style={{ padding: "1.25rem", flex: 1, minWidth: 220 }}>
        <div className="section-title" style={{ marginBottom: "0.75rem" }}>
          <h3>Detected Position</h3>
        </div>

        <div style={{ display: "grid", gap: "0.65rem" }}>
          <Row label="Hand detected" value={landmark ? "Yes" : "No"} highlight={Boolean(landmark)} />
          <Row label="Raw x (0–1, mirrored)" value={landmark ? landmark.x.toFixed(4) : "—"} />
          <Row label="Raw y (0–1)" value={landmark ? landmark.y.toFixed(4) : "—"} />
          <div style={{ height: 1, background: "var(--border, #e2e8f0)", margin: "0.25rem 0" }} />
          <Row label="Game X (±4.2)" value={gameX} />
          <Row label="Game Z (±3.2)" value={gameZ} />
          <Row label="Game Y" value="0.78 (fixed)" />
        </div>

        <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted, #64748b)", lineHeight: 1.55 }}>
          Game coords match the formula used in <code>useMediaPipeHands.ts</code>.
          Verify these map correctly to your play area before enabling in-game.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", fontSize: "0.82rem", alignItems: "center" }}>
      <span style={{ color: "var(--text-muted, #64748b)" }}>{label}</span>
      <strong style={{ fontVariantNumeric: "tabular-nums", color: highlight ? "#22c55e" : "inherit" }}>
        {value}
      </strong>
    </div>
  );
}
