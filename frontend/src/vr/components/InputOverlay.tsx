import type { RefObject } from "react";

interface GloveControl {
  isConnected: boolean;
  gesture: string;
  connect(): void;
  disconnect(): void;
}

interface CameraControl {
  isActive: boolean;
  isLoading: boolean;
  startCamera(): void;
  stopCamera(): void;
  videoRef: RefObject<HTMLVideoElement>;
}

export function InputOverlay({ glove, camera }: { glove: GloveControl; camera: CameraControl }) {
  return (
    <>
      {/* Hidden video element — MediaPipe needs it in the DOM but users don't see it */}
      <video
        ref={camera.videoRef}
        muted
        playsInline
        style={{ position: "fixed", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
      />

      <div style={overlayStyle}>
        <Row
          label="Glove"
          active={glove.isConnected}
          activeLabel="Connected"
          inactiveLabel="Connect Glove"
          loading={false}
          onClick={glove.isConnected ? glove.disconnect : glove.connect}
        />
        <Row
          label="Camera"
          active={camera.isActive}
          activeLabel="Stop Camera"
          inactiveLabel={camera.isLoading ? "Starting…" : "Start Camera"}
          loading={camera.isLoading}
          onClick={camera.isActive ? camera.stopCamera : camera.startCamera}
        />
        <div style={gestureRowStyle}>
          <span style={gestureLabelStyle}>Gesture</span>
          <span style={gestureValueStyle}>{glove.gesture}</span>
        </div>
      </div>
    </>
  );
}

function Row({
  label: _label,
  active,
  activeLabel,
  inactiveLabel,
  loading,
  onClick,
}: {
  label: string;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  loading: boolean;
  onClick(): void;
}) {
  return (
    <div style={rowStyle}>
      <button style={btnStyle(active)} onClick={onClick} disabled={loading}>
        {active ? activeLabel : inactiveLabel}
      </button>
      <span style={dotStyle(active)} title={active ? "active" : "inactive"} />
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 100,
  background: "rgba(0,0,0,0.65)",
  backdropFilter: "blur(6px)",
  borderRadius: 8,
  padding: "10px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 188,
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  color: "#e8e8e8",
  userSelect: "none",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const btnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "5px 10px",
  borderRadius: 5,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  background: active ? "#2d7a2d" : "#3a3a3a",
  color: "#fff",
  transition: "background 0.15s",
});

const dotStyle = (active: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
  background: active ? "#4caf50" : "#555",
  boxShadow: active ? "0 0 4px #4caf50" : "none",
  transition: "background 0.15s",
});

const gestureRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  paddingTop: 4,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const gestureLabelStyle: React.CSSProperties = { color: "#888" };
const gestureValueStyle: React.CSSProperties = { fontWeight: 700, color: "#e8e8e8" };
