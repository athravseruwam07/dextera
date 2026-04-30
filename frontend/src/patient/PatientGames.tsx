import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Line, RoundedBox, useGLTF } from "@react-three/drei";
import planck from "planck-js";
import {
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { PatientGameFullscreenContext, type PatientGameFullscreenControls } from "./patientGameFullscreenContext";
import { CheckCircle2, CircleDot, Crosshair, Maximize2, Minimize2, Music2, Sparkles, Trophy, Volume2, VolumeX } from "lucide-react";
import { Box3, DoubleSide, Group, Mesh, Vector3 } from "three";
import carromBoardModelUrl from "../assets/carrom_board_optimized.glb?url";
import { fingerNames, gestureLabels, gestureTargets, weakestFinger as weakestFingerFromEvents } from "../lib/gesture";
import type { FingerName, GameId, GestureEvent, GestureName, HandPosition, PatientCareAssignment } from "../types";
import {
  emitFingerTap,
  usePatientInput
} from "./input";
import { useFullscreen } from "../lib/useFullscreen";
import type { GamePlayResult } from "./gameTypes";
import { FingerTapPianoLanesGame } from "./FingerTapPianoLanes";
import { ballPickupGripAction } from "./ballPickupGrip";
import { loadPianoMuted, playPianoSound, storePianoMuted, unlockPianoAudio } from "./pianoAudio";

export type { GamePlayResult } from "./gameTypes";

type GameProps = {
  assignment: PatientCareAssignment;
  onComplete: (result: GamePlayResult) => void;
};

type Point = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };

const fingerLabels: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3D(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function titleLabel(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function difficultyLabel(value: PatientCareAssignment["config"]["difficulty"]) {
  return titleLabel(value);
}

function useGameEvents() {
  const { events } = usePatientInput();
  const startedAtRef = useRef(Date.now());

  return useMemo(
    () => events.filter((event) => new Date(event.timestamp).getTime() >= startedAtRef.current),
    [events]
  );
}

function useCompletion(onComplete: (result: GamePlayResult) => void) {
  const startedAtRef = useRef(Date.now());
  const completedRef = useRef(false);

  return (result: Omit<GamePlayResult, "timeTakenSeconds">) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete({
      ...result,
      timeTakenSeconds: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    });
  };
}

function GameHeader({
  assignment,
  children,
  hideReadout = true
}: {
  assignment: PatientCareAssignment;
  children: ReactNode;
  hideReadout?: boolean;
}) {
  const { currentGesture, fingerBends, handPosition } = usePatientInput();

  return (
    <div className="game-header">
      <div>
        <span className="eyebrow">Now Playing</span>
        <h2>{assignment.name}</h2>
        <p>{assignment.config.targetReps} Target Reps · {difficultyLabel(assignment.config.difficulty)} · {gestureLabels[currentGesture]}</p>
      </div>
      {!hideReadout && (
        <div className="game-header-panel">
          <div className="game-input-readout">
            <span>Hand {handPosition.x},{handPosition.y}</span>
            <span>Index {fingerBends.index}%</span>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function Cursor({ position }: { position: HandPosition }) {
  return (
    <div
      className="game-cursor"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      aria-hidden="true"
    />
  );
}

/** Minimal fingertip tracker for Bubble Pop — ring + halo, no hand illustration. */
function BubblePopAimCursor({
  position,
  gesture
}: {
  position: HandPosition;
  gesture: GestureName;
}) {
  const mode =
    gesture === "pinch"
      ? "bubble-pop-aim-cursor--pinch"
      : gesture === "point"
        ? "bubble-pop-aim-cursor--point"
        : "";

  return (
    <div
      className={`bubble-pop-aim-cursor ${mode}`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      aria-hidden="true"
    >
      <span className="bubble-pop-aim-cursor__pulse" aria-hidden />
      <span className="bubble-pop-aim-cursor__halo" aria-hidden />
      <span className="bubble-pop-aim-cursor__ring" aria-hidden />
      <span className="bubble-pop-aim-cursor__dot" aria-hidden />
    </div>
  );
}

function GameCompletionCelebration({
  assignment,
  result,
  onContinue
}: {
  assignment: PatientCareAssignment;
  result: GamePlayResult;
  onContinue: () => void;
}) {
  const proceedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => proceedRef.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(id);
  }, []);

  const streakLine =
    assignment.gameId === "finger-tap-piano" && result.bestStreak != null && result.bestStreak > 0 ? (
      <div className="game-completion-mini">
        <strong>Best streak</strong>
        <span>{result.bestStreak} in a row</span>
      </div>
    ) : null;

  const weakLine =
    result.weakestFinger ? (
      <div className="game-completion-mini">
        <strong>Focus area</strong>
        <span>{fingerLabels[result.weakestFinger]} (from this run)</span>
      </div>
    ) : null;

  return (
    <div className="game-completion-overlay" role="dialog" aria-modal="true" aria-labelledby="game-completion-heading">
      <div className="game-completion-backdrop" aria-hidden />
      <div className="game-completion-burst" aria-hidden>
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className={`game-completion-particle game-completion-particle--${i % 5}`}
            style={{ left: `${4 + (i % 10) * 9.8}%`, animationDelay: `${i * 0.058}s` }}
          />
        ))}
      </div>
      <article className="game-completion-card">
        <header className="game-completion-heading">
          <div className="game-completion-medal">
            <Trophy size={42} aria-hidden strokeWidth={2} />
            <CheckCircle2 className="game-completion-check" aria-hidden strokeWidth={2.5} />
          </div>
          <h2 id="game-completion-heading">Session complete</h2>
          <p>You finished <strong>{assignment.name}</strong> — take a breath before your check-in.</p>
        </header>

        <div className="game-completion-metrics">
          <div className="game-completion-accuracy-hero">
            <span className="game-completion-accuracy-value">{Math.round(result.accuracy)}%</span>
            <span className="game-completion-accuracy-label">Accuracy</span>
          </div>

          <dl className="game-completion-stats">
            <div>
              <dt>Time</dt>
              <dd>{Math.max(1, result.timeTakenSeconds)}s</dd>
            </div>
            <div>
              <dt>Successful</dt>
              <dd>
                {result.successfulReps}/{assignment.config.targetReps}
              </dd>
            </div>
            <div>
              <dt>Misses</dt>
              <dd>{result.failedAttempts}</dd>
            </div>
          </dl>
          {streakLine}
          {weakLine}
        </div>

        <button
          ref={proceedRef}
          type="button"
          className="primary-button game-completion-next"
          onClick={onContinue}
        >
          Continue to wellness check-in
        </button>
        <p className="game-completion-caption">Answer two quick questions about how your hand feels — then save your progress.</p>
      </article>
    </div>
  );
}

export function PatientGame({
  assignment,
  onComplete
}: GameProps) {
  const games: Record<GameId, ComponentType<GameProps>> = {
    "ball-pickup": BallPickupGame,
    "finger-tap-piano": FingerTapPianoGame,
    "bubble-pop": BubblePopGame,
    "carrom-flick": CarromGame
  };
  const Component = games[assignment.gameId];

  const shellRef = useRef<HTMLElement | null>(null);
  const exitFsRef = useRef<HTMLButtonElement | null>(null);
  const [completionResult, setCompletionResult] = useState<GamePlayResult | null>(null);
  const { isFullscreen, isSupported, enterFullscreen, exitFullscreen } = useFullscreen(shellRef);

  const fullscreenControls = useMemo<PatientGameFullscreenControls>(
    () => ({
      isFullscreen,
      isSupported,
      enterFullscreen,
      exitFullscreen,
      exitButtonRef: exitFsRef
    }),
    [isFullscreen, isSupported, enterFullscreen, exitFullscreen]
  );

  const showShellFullscreenToolbar = !(
    assignment.gameId === "finger-tap-piano" && assignment.config.difficulty === "hard"
  );

  const handleGameCompletion = useCallback(
    async (result: GamePlayResult) => {
      try {
        await exitFullscreen();
      } catch {
        /* host may disallow */
      }
      setCompletionResult(result);
    },
    [exitFullscreen]
  );

  const advanceLockedRef = useRef(false);

  const advanceAfterCelebration = useCallback(() => {
    if (advanceLockedRef.current || !completionResult) return;
    advanceLockedRef.current = true;
    const payload = completionResult;
    setCompletionResult(null);
    onComplete(payload);
  }, [completionResult, onComplete]);

  useEffect(() => {
    if (isFullscreen) {
      const id = window.setTimeout(() => exitFsRef.current?.focus({ preventScroll: true }), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isFullscreen]);

  return (
    <PatientGameFullscreenContext.Provider value={fullscreenControls}>
      <section ref={shellRef} className="patient-game-shell">
        {!completionResult && showShellFullscreenToolbar && (
          <div className="patient-game-fs-toolbar" role="toolbar" aria-label="Game display">
            {isSupported ? (
              <>
                {!isFullscreen ? (
                  <button
                    type="button"
                    className="secondary-button patient-game-fs-btn"
                    onClick={() => void enterFullscreen()}
                    aria-label="Enter fullscreen"
                  >
                    <Maximize2 size={16} strokeWidth={2} aria-hidden />
                    Fullscreen
                  </button>
                ) : (
                  <button
                    ref={exitFsRef}
                    type="button"
                    className="secondary-button patient-game-fs-btn"
                    onClick={() => void exitFullscreen()}
                    aria-label="Exit fullscreen"
                    aria-describedby="patient-game-fs-esc-hint"
                  >
                    <Minimize2 size={16} strokeWidth={2} aria-hidden />
                    Exit fullscreen
                  </button>
                )}
                {isFullscreen && (
                  <span className="patient-game-fs-hint" id="patient-game-fs-esc-hint">
                    Press Esc to exit fullscreen
                  </span>
                )}
              </>
            ) : (
              <span className="patient-game-fs-unavailable" role="note">
                Fullscreen is not available in this browser.
              </span>
            )}
          </div>
        )}

        <div className={`patient-game-stage-wrap${completionResult ? " patient-game-stage-wrap--paused" : ""}`}>
          <Component
            assignment={assignment}
            onComplete={handleGameCompletion}
          />
        </div>

        {completionResult && (
          <GameCompletionCelebration
            assignment={assignment}
            result={completionResult}
            onContinue={advanceAfterCelebration}
          />
        )}
      </section>
    </PatientGameFullscreenContext.Provider>
  );
}

const playArea = {
  xMin: -3.25,
  xMax: 3.25,
  zMin: -2.1,
  zMax: 2.1,
  handY: 0.9,
  tableY: 0.08
};

const basketPosition: Vec3 = { x: 2.3, y: 0.24, z: -0.3 };

/** Top Y of tabletop (box centered at origin, thickness 0.14) — used for decals and grid flush */
const TABLE_SURFACE_Y = 0.072;

const ballSpawns: Vec3[] = [
  { x: -2.05, y: 0.32, z: 0.35 },
  { x: -1.25, y: 0.32, z: -1.05 },
  { x: -2.35, y: 0.32, z: -0.8 },
  { x: -0.9, y: 0.32, z: 0.92 }
];

function handPositionToWorld(position: HandPosition): Vec3 {
  return {
    x: clamp((position.x / 100 - 0.5) * (playArea.xMax - playArea.xMin), playArea.xMin, playArea.xMax),
    y: playArea.handY,
    z: clamp((position.y / 100 - 0.5) * (playArea.zMax - playArea.zMin), playArea.zMin, playArea.zMax)
  };
}

function currentAccuracy(successes: number, failed: number) {
  return clampPercent((successes / Math.max(successes + failed, 1)) * 100);
}

function BallPickupGame({ assignment, onComplete }: GameProps) {
  const input = usePatientInput();
  const sessionEvents = useGameEvents();
  const finish = useCompletion(onComplete);
  const ballSpawnIndexRef = useRef(0);
  const ballPositionRef = useRef<Vec3>(ballSpawns[0]);
  const heldRef = useRef(false);
  const selectedRef = useRef(false);
  const previousGripRef = useRef<"open" | "fist">("open");
  const closedAwayFromBallRef = useRef(false);
  const successesRef = useRef(0);
  const failedRef = useRef(0);
  const [ballPosition, setBallPosition] = useState<Vec3>(ballSpawns[0]);
  const [selected, setSelected] = useState(false);
  const [held, setHeld] = useState(false);
  const [successes, setSuccesses] = useState(0);
  const [failed, setFailed] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);
  const [feedback, setFeedback] = useState("Move the hand above the ball, then make a fist to pick it up.");
  const targetReps = assignment.config.targetReps;
  const ballRadius = 0.26;
  const basketRadius = 0.68;
  const grabRadius = 0.58;
  const handWorld = handPositionToWorld(input.handPosition);
  const ballDistance = distance3D(handWorld, ballPosition);
  const canReachBall = ballDistance <= grabRadius;
  const gripGesture: "open" | "fist" = input.currentGesture === "fist" ? "fist" : "open";
  const accuracy = currentAccuracy(successes, failed);
  const roundActive = started && countdown === 0 && !paused;

  useEffect(() => {
    ballPositionRef.current = ballPosition;
  }, [ballPosition]);

  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    successesRef.current = successes;
  }, [successes]);

  useEffect(() => {
    failedRef.current = failed;
  }, [failed]);

  useEffect(() => {
    if (!started || countdown > 0 || paused) return;
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [countdown, paused, started]);

  useEffect(() => {
    if (!started || countdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          setFeedback("Move the hand above the ball, then make a fist to pick it up.");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown, started]);

  useEffect(() => {
    function moveByKeyboard(event: KeyboardEvent) {
      if (!roundActive) return;
      const key = event.key.toLowerCase();
      const direction = {
        x: key === "arrowleft" || key === "a" ? -1 : key === "arrowright" || key === "d" ? 1 : 0,
        y: key === "arrowup" || key === "w" ? -1 : key === "arrowdown" || key === "s" ? 1 : 0
      };
      if (!direction.x && !direction.y) return;
      event.preventDefault();
      const step = 6;
      input.setHandPosition({
        x: input.handPosition.x + direction.x * step,
        y: input.handPosition.y + direction.y * step,
        z: input.handPosition.z
      });
    }

    window.addEventListener("keydown", moveByKeyboard);
    return () => window.removeEventListener("keydown", moveByKeyboard);
  }, [input, roundActive]);

  useEffect(() => {
    if (held) return;
    if (!canReachBall && selected) {
      setSelected(false);
    }
  }, [canReachBall, held, selected]);

  useEffect(() => {
    if (!roundActive || held || selected || !canReachBall || gripGesture === "fist") return;
    setFeedback("Ball is in reach. Make a fist to pick it up.");
  }, [canReachBall, gripGesture, held, roundActive, selected]);

  const spawnNextBall = () => {
    window.setTimeout(() => {
      ballSpawnIndexRef.current = (ballSpawnIndexRef.current + 1) % ballSpawns.length;
      const nextBall = ballSpawns[ballSpawnIndexRef.current];
      ballPositionRef.current = nextBall;
      setBallPosition(nextBall);
      setSuccessFlash(false);
    }, 650);
  };

  const releaseBallAt = (releasePosition: Vec3) => {
    if (!heldRef.current) return;
    const scored = distance3D(releasePosition, basketPosition) <= basketRadius;
    heldRef.current = false;
    selectedRef.current = false;
    setHeld(false);
    setSelected(false);

    if (scored) {
      const nextSuccesses = successesRef.current + 1;
      successesRef.current = nextSuccesses;
      setSuccesses(nextSuccesses);
      setSuccessFlash(true);
      setFeedback("Nice drop. A new ball is ready.");
      const basketDrop = { ...basketPosition, y: 0.34 };
      ballPositionRef.current = basketDrop;
      setBallPosition(basketDrop);

      if (nextSuccesses >= targetReps) {
        finish({
          repsCompleted: nextSuccesses,
          successfulReps: nextSuccesses,
          failedAttempts: failedRef.current,
          accuracy: currentAccuracy(nextSuccesses, failedRef.current),
          weakestFinger: sessionEvents.length ? weakestFingerFromEvents(sessionEvents) : undefined,
          events: sessionEvents,
          gameMetrics: {
            failedDrops: failedRef.current,
            releaseAccuracy: currentAccuracy(nextSuccesses, failedRef.current),
            elapsedSeconds
          }
        });
      } else {
        spawnNextBall();
      }
      return;
    }

    const nextFailed = failedRef.current + 1;
    failedRef.current = nextFailed;
    setFailed(nextFailed);
    ballPositionRef.current = releasePosition;
    setBallPosition(releasePosition);
    setFeedback("Dropped outside the basket. Pick it up again and try a slower release.");
  };

  const grabBallAt = (worldPosition: Vec3) => {
    if (heldRef.current) return false;
    if (distance3D(worldPosition, ballPositionRef.current) > grabRadius) {
      setFeedback("Move the hand above the ball, then make a fist.");
      return false;
    }

    selectedRef.current = true;
    heldRef.current = true;
    setSelected(true);
    setHeld(true);
    setFeedback("Grabbed. Move to the basket, then open your hand to drop.");
    return true;
  };

  const pointerToInputPosition = (event: ReactPointerEvent<HTMLDivElement>): HandPosition => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
      z: 0
    };
  };

  useEffect(() => {
    if (!roundActive) return;
    if (previousGripRef.current === gripGesture) return;

    const previousGrip = previousGripRef.current;
    previousGripRef.current = gripGesture;

    const action = ballPickupGripAction({
      previousGrip,
      nextGrip: gripGesture,
      canReachBall,
      held: heldRef.current
    });

    if (action === "grab") {
      closedAwayFromBallRef.current = false;
      grabBallAt(handWorld);
      return;
    }

    if (action === "closed-away") {
      closedAwayFromBallRef.current = true;
      setFeedback("Move the hand above the ball, then make a fist.");
      return;
    }

    if (action === "release") {
      closedAwayFromBallRef.current = false;
      releaseBallAt({ x: handWorld.x, y: 0.34, z: handWorld.z });
      return;
    }

    if (action === "opened-empty") {
      closedAwayFromBallRef.current = false;
      setFeedback(canReachBall ? "Ball is in reach. Make a fist to pick it up." : "Move the hand above the ball, then make a fist.");
    }
  }, [canReachBall, gripGesture, handWorld.x, handWorld.z, roundActive]);

  useEffect(() => {
    if (!roundActive || gripGesture !== "fist" || !held || closedAwayFromBallRef.current) return;
    setFeedback("Holding. Move to the basket, then open your hand to drop.");
  }, [gripGesture, held, roundActive]);

  const startRound = () => {
    previousGripRef.current = gripGesture;
    setStarted(true);
    setPaused(false);
    setCountdown(3);
    setFeedback("Get ready. Start with a relaxed open hand.");
  };

  const completeNow = () => {
    finish({
      repsCompleted: successes,
      successfulReps: successes,
      failedAttempts: failed,
      accuracy,
      weakestFinger: sessionEvents.length ? weakestFingerFromEvents(sessionEvents) : undefined,
      events: sessionEvents,
      gameMetrics: {
        failedDrops: failed,
        releaseAccuracy: accuracy,
        elapsedSeconds
      }
    });
  };

  return (
    <>
      <GameHeader assignment={assignment} hideReadout>
        <div className="game-score-row">
          <strong>{successes}/{targetReps}</strong>
          <span>Reps</span>
          <strong>{failed}</strong>
          <span>Fails</span>
          <strong>{elapsedSeconds}s</strong>
          <span>Timer</span>
          <strong>{gestureLabels[gripGesture]}</strong>
          <span>Gesture</span>
          <strong>{accuracy}%</strong>
          <span>Accuracy</span>
          {!started && (
            <button type="button" className="primary-button compact-game-button" onClick={startRound}>
              Start
            </button>
          )}
          <button type="button" className="secondary-button compact-game-button" disabled={!started || countdown > 0} onClick={() => setPaused((value) => !value)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="danger-button compact-game-button" disabled={!started} onClick={completeNow}>
            End Session
          </button>
        </div>
      </GameHeader>
      <div
        className="ball-3d-board"
        tabIndex={0}
        onPointerMove={(event) => {
          if (!roundActive) return;
          input.setHandPosition(pointerToInputPosition(event));
        }}
      >
        <Canvas
          shadows
          camera={{ position: [0, 4.45, 6.2], fov: 46 }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <BallPickupScene
            ballPosition={ballPosition}
            ballRadius={ballRadius}
            basketRadius={basketRadius}
            canReachBall={canReachBall}
            gesture={gripGesture}
            handTarget={handWorld}
            held={held}
            paused={paused}
            selected={selected}
            successFlash={successFlash}
          />
        </Canvas>
        {!started && (
          <div className="ball-3d-overlay">
            <button type="button" className="primary-button" onClick={startRound}>Start Ball Pickup</button>
          </div>
        )}
        {started && countdown > 0 && <div className="ball-3d-overlay">{countdown}</div>}
        {paused && <div className="ball-3d-overlay">Paused</div>}
      </div>
      <p className="game-feedback">{feedback}</p>
    </>
  );
}

function BallPickupScene({
  ballPosition,
  ballRadius,
  basketRadius,
  canReachBall,
  gesture,
  handTarget,
  held,
  paused,
  selected,
  successFlash
}: {
  ballPosition: Vec3;
  ballRadius: number;
  basketRadius: number;
  canReachBall: boolean;
  gesture: string;
  handTarget: Vec3;
  held: boolean;
  paused: boolean;
  selected: boolean;
  successFlash: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#e8f5f2"]} />
      <fog attach="fog" args={["#eef6f6", 19, 50]} />

      <Environment preset="city" />

      <hemisphereLight args={["#f0faf9", "#cbe8dd", 0.62]} />
      <ambientLight intensity={0.42} />

      <directionalLight
        castShadow
        intensity={1.74}
        color="#fffefb"
        position={[5.6, 9.1, 4.05]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.38}
        shadow-camera-far={34}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-normalBias={0.02}
      />
      <directionalLight intensity={0.52} position={[-4.5, 4.95, -3.95]} color="#cfdff8" />
      <pointLight
        intensity={successFlash ? 1.88 : 0.74}
        position={[basketPosition.x + 0.42, 1.54, basketPosition.z - 0.22]}
        color={successFlash ? "#4ade80" : "#c5fae5"}
        distance={10}
        decay={2}
      />

      <ContactShadows position={[0, TABLE_SURFACE_Y + 0.001, 0]} opacity={0.52} scale={34} blur={3.35} far={17} color="#032e28" />

      <Table3D />

      <BallPickupCourtDecor basketRadius={basketRadius} />

      <Basket3D radius={basketRadius} successFlash={successFlash} />
      <Ball3D
        ballPosition={ballPosition}
        handTarget={handTarget}
        held={held}
        highlighted={selected || canReachBall}
        radius={ballRadius}
      />
      <Hand3D gesture={gesture} handTarget={handTarget} held={held} paused={paused} />
    </>
  );
}

function Table3D() {
  return (
    <group>
      <RoundedBox args={[7.55, 0.11, 5.12]} radius={0.09} smoothness={4} position={[0, -0.015, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#9fb8ae" roughness={0.7} metalness={0.02} envMapIntensity={0.75} />
      </RoundedBox>
      <RoundedBox args={[7.4, 0.14, 5]} radius={0.078} smoothness={5} castShadow receiveShadow>
        <meshStandardMaterial color="#def3ea" roughness={0.44} metalness={0.05} envMapIntensity={1.1} />
      </RoundedBox>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]}>
        <planeGeometry args={[12, 9.2]} />
        <meshStandardMaterial color="#b4c8c1" roughness={0.92} envMapIntensity={0.62} />
      </mesh>
    </group>
  );
}

/** Court grid, tinted zones, teal border line, cues toward basket & ball areas */
function BallPickupCourtDecor({ basketRadius }: { basketRadius: number }) {
  const courtW = playArea.xMax - playArea.xMin;
  const courtD = playArea.zMax - playArea.zMin;
  const midZ = (playArea.zMin + playArea.zMax) / 2;
  const yLine = TABLE_SURFACE_Y + 0.0021;
  const { xMin, xMax, zMin, zMax } = playArea;

  const outline: [number, number, number][] = [
    [xMin + 0.035, yLine, zMin + 0.065],
    [xMax - 1.94, yLine, zMin + 0.065],
    [xMax - 0.02, yLine, zMin + 0.065],
    [xMax - 0.02, yLine, zMax - 0.065],
    [xMin + 1.78, yLine, zMax - 0.065],
    [xMin + 0.035, yLine, zMax - 0.065],
    [xMin + 0.035, yLine, zMin + 0.065]
  ];

  return (
    <group>
      <Grid
        infiniteGrid={false}
        args={[courtW + 0.08, courtD + 0.08]}
        cellSize={0.6}
        cellThickness={1.02}
        cellColor="#bee8db"
        sectionSize={2.04}
        sectionThickness={1.48}
        sectionColor="#5bbca5"
        fadeDistance={24}
        fadeStrength={1}
        position={[0, TABLE_SURFACE_Y + 0.0005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {/* Soft half-court color bands */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[xMin + courtW * 0.28, TABLE_SURFACE_Y + 0.0011, midZ]} receiveShadow>
        <planeGeometry args={[courtW * 0.62, courtD * 0.009]} />
        <meshStandardMaterial transparent opacity={0.22} color="#8be2cd" roughness={0.9} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[xMin + courtW * 0.74, TABLE_SURFACE_Y + 0.0011, midZ]} receiveShadow>
        <planeGeometry args={[courtW * 0.48, courtD * 0.009]} />
        <meshStandardMaterial transparent opacity={0.19} color="#aadcf2" roughness={0.9} depthWrite={false} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[basketPosition.x - 1.04, TABLE_SURFACE_Y + 0.0014, basketPosition.z]}>
        <ringGeometry args={[basketRadius * 1.06, basketRadius * 1.48, 64]} />
        <meshStandardMaterial
          transparent
          opacity={0.46}
          color="#73eace"
          roughness={0.36}
          emissive="#69eacb"
          emissiveIntensity={0.12}
          depthWrite={false}
        />
      </mesh>

      <Line points={outline} color="#23a894" lineWidth={1.95} transparent opacity={0.88} />

      {/* Small floor markers */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[playArea.xMin + 1.92, TABLE_SURFACE_Y + 0.0012, basketPosition.z]}>
        <circleGeometry args={[0.064, 32]} />
        <meshStandardMaterial transparent opacity={0.4} color="#fb923c" roughness={0.45} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[playArea.xMax - 0.95, TABLE_SURFACE_Y + 0.0012, playArea.zMax - 0.42]}>
        <circleGeometry args={[0.052, 24]} />
        <meshStandardMaterial transparent opacity={0.33} color="#38bdf8" roughness={0.45} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Basket3D({ radius, successFlash }: { radius: number; successFlash: boolean }) {
  const wallH = 0.44;
  const baseH = 0.055;
  /** Slight taper so the rim reads wider than the foot on the table */
  const rTop = radius * 1.02;
  const rBottom = radius * 0.94;
  /** Floor disc radius: just inside the lower wall ring (avoids z-fighting) */
  const rFloor = rBottom * 0.96;

  const wallGlass = successFlash ? "#6ee7b7" : "#5eead4";
  const baseGlass = successFlash ? "#a7f3d0" : "#ccfbf1";
  const rimColor = successFlash ? "#22c55e" : "#0f766e";

  return (
    <group position={[basketPosition.x, basketPosition.y, basketPosition.z]}>
      {/* Translucent wall — open cylinder, double-sided */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[rTop, rBottom, wallH, 64, 1, true]} />
        <meshPhysicalMaterial
          color={wallGlass}
          transparent
          opacity={0.38}
          transmission={0.72}
          thickness={0.48}
          roughness={0.14}
          metalness={0.05}
          clearcoat={0.55}
          clearcoatRoughness={0.12}
          ior={1.38}
          side={DoubleSide}
          envMapIntensity={1}
        />
      </mesh>
      {/* Solid floor: closed short cylinder = real base you can see through the sides */}
      <mesh castShadow receiveShadow position={[0, -wallH / 2 + baseH / 2, 0]}>
        <cylinderGeometry args={[rFloor, rFloor, baseH, 64, 1, false]} />
        <meshPhysicalMaterial
          color={baseGlass}
          transparent
          opacity={successFlash ? 0.78 : 0.62}
          transmission={0.45}
          thickness={baseH * 1.6}
          roughness={0.32}
          metalness={0.06}
          clearcoat={0.22}
          clearcoatRoughness={0.4}
          ior={1.45}
        />
      </mesh>
      {/* Rim */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, wallH / 2 - 0.015, 0]}>
        <torusGeometry args={[rTop * 0.985, Math.max(0.028, radius * 0.052), 12, 64]} />
        <meshStandardMaterial
          color={rimColor}
          roughness={0.35}
          metalness={0.12}
          emissive={successFlash ? rimColor : "#000000"}
          emissiveIntensity={successFlash ? 0.28 : 0}
        />
      </mesh>
    </group>
  );
}

function Ball3D({
  ballPosition,
  handTarget,
  held,
  highlighted,
  radius
}: {
  ballPosition: Vec3;
  handTarget: Vec3;
  held: boolean;
  highlighted: boolean;
  radius: number;
}) {
  const meshRef = useRef<Group>(null);
  const targetRef = useRef(new Vector3(ballPosition.x, ballPosition.y, ballPosition.z));

  useFrame(() => {
    if (!meshRef.current) return;
    const target = held
      ? targetRef.current.set(handTarget.x, handTarget.y - 0.34, handTarget.z - 0.12)
      : targetRef.current.set(ballPosition.x, ballPosition.y, ballPosition.z);
    meshRef.current.position.lerp(target, held ? 0.34 : 0.18);
  });

  return (
    <group ref={meshRef} castShadow receiveShadow>
      <mesh>
        <sphereGeometry args={[radius, 48, 48]} />
        <meshPhysicalMaterial
          color={held ? "#fef08a" : "#e6f23a"}
          emissive={highlighted || held ? "#fbbf24" : "#2a3a00"}
          emissiveIntensity={held ? 0.15 : highlighted ? 0.1 : 0.04}
          roughness={0.38}
          metalness={0.02}
          clearcoat={0.55}
          clearcoatRoughness={0.26}
          envMapIntensity={1.15}
        />
      </mesh>
      {/* Tennis-style seam ring */}
      <mesh rotation={[Math.PI / 2, 0.25, 0]}>
        <torusGeometry args={[radius * 0.988, Math.max(0.014, radius * 0.058), 14, 96]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.28} metalness={0.05} opacity={0.95} transparent envMapIntensity={0.8} />
      </mesh>
      {highlighted && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -radius - 0.02, 0]}>
          <torusGeometry args={[radius * 1.42, 0.022, 8, 48]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.32} />
        </mesh>
      )}
    </group>
  );
}

function Hand3D({
  gesture,
  handTarget,
  held,
  paused
}: {
  gesture: string;
  handTarget: Vec3;
  held: boolean;
  paused: boolean;
}) {
  const handRef = useRef<Group>(null);
  const targetRef = useRef(new Vector3(handTarget.x, handTarget.y, handTarget.z));

  useFrame(() => {
    if (!handRef.current) return;
    targetRef.current.set(handTarget.x, handTarget.y, handTarget.z);
    handRef.current.position.lerp(targetRef.current, paused ? 0.06 : 0.2);
  });

  const fingerLength = gesture === "fist" || gesture === "pinch" ? 0.34 : gesture === "point" ? 0.55 : 0.72;
  const indexLength = gesture === "point" ? 0.88 : fingerLength;
  const fingerColor = held ? "#fbbf24" : gesture === "open" ? "#22c55e" : "#38bdf8";
  const fingerOffsets = [-0.24, -0.08, 0.08, 0.24];
  const handOpacity = held ? 0.44 : 0.36;

  return (
    <group ref={handRef} rotation={[-0.16, 0, 0]}>
      <RoundedBox castShadow position={[0, 0, 0]} args={[0.72, 0.22, 0.56]} radius={0.08} smoothness={4}>
        <meshStandardMaterial color="#f4c4a8" roughness={0.5} transparent opacity={handOpacity} depthWrite={false} />
      </RoundedBox>
      {fingerOffsets.map((x, index) => {
        const length = index === 1 ? indexLength : fingerLength;
        return (
          <RoundedBox key={x} castShadow position={[x, 0.05, -0.32 - length / 2]} args={[0.12, 0.12, length]} radius={0.034} smoothness={3}>
            <meshStandardMaterial color={fingerColor} roughness={0.46} transparent opacity={handOpacity} depthWrite={false} />
          </RoundedBox>
        );
      })}
      <RoundedBox castShadow rotation={[0, 0.45, -0.35]} position={[-0.46, -0.02, -0.05]} args={[0.13, 0.12, gesture === "pinch" ? 0.58 : 0.46]} radius={0.04} smoothness={3}>
        <meshStandardMaterial color={fingerColor} roughness={0.48} transparent opacity={handOpacity} depthWrite={false} />
      </RoundedBox>
      <RoundedBox castShadow position={[0, -0.05, 0.42]} args={[0.55, 0.16, 0.34]} radius={0.07} smoothness={3}>
        <meshStandardMaterial color="#efc4a4" roughness={0.54} transparent opacity={handOpacity} depthWrite={false} />
      </RoundedBox>
      {held && (
        <mesh position={[0, -0.26, -0.3]}>
          <sphereGeometry args={[0.09, 20, 20]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.22} />
        </mesh>
      )}
    </group>
  );
}

function strongestFingerFromBends(bends: Record<FingerName, number>): FingerName {
  return fingerNames
    .map((finger) => ({ finger, value: bends[finger] }))
    .sort((a, b) => b.value - a.value)[0].finger;
}

type PianoPhase = "idle" | "playing" | "paused" | "complete";

type PianoPreset = {
  requiredHits: number;
  holdRequiredMs: number;
  restEveryHits: number;
  restSeconds: number;
  timeLimitSeconds: number | null;
};

function fingerTapPianoPreset(assignment: PatientCareAssignment): PianoPreset {
  const { difficulty, targetReps } = assignment.config;
  if (difficulty !== "easy" && difficulty !== "medium") {
    throw new Error("fingerTapPianoPreset: classic mode supports only Easy or Medium");
  }
  const tier = difficulty === "easy" ? 10 : 14;
  const requiredHits = clamp(
    Math.round(tier + Math.floor(Math.max(targetReps, 4) / 2)),
    10,
    20
  );
  const holdRequiredMs =
    difficulty === "easy"
      ? 0
      : 120;
  const restEveryHits = difficulty === "easy" ? 8 : 6;
  const restSeconds = difficulty === "easy" ? 12 : 9;
  const timeLimitSeconds = null;

  return {
    requiredHits,
    holdRequiredMs,
    restEveryHits,
    restSeconds,
    timeLimitSeconds
  };
}

function nextRandomFinger(exclude?: FingerName): FingerName {
  const pool = exclude ? fingerNames.filter((finger) => finger !== exclude) : fingerNames;
  return pool[Math.floor(Math.random() * pool.length)] ?? fingerNames[0];
}

function bendsFromGestureEvent(event: GestureEvent): Record<FingerName, number> {
  return {
    thumb: event.thumb,
    index: event.index,
    middle: event.middle,
    ring: event.ring,
    pinky: event.pinky
  };
}

/** Which finger a tap_* event names — use this so queued events still score (demo stream is not always events[0]). */
function fingerFromTapGestureName(gesture: GestureName): FingerName | null {
  if (!gesture.startsWith("tap_")) return null;
  const rest = gesture.slice(4);
  return (fingerNames as readonly string[]).includes(rest) ? (rest as FingerName) : null;
}

const PIANO_UI_FINGER: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

type PianoPlayState = {
  currentTarget: FingerName;
  hits: number;
  misses: number;
  streak: number;
  bestStreak: number;
  missesByFinger: Record<FingerName, number>;
  restEndsAt: number | null;
  timedOut: boolean;
};

const emptyFingerCounts = (): Record<FingerName, number> => ({
  thumb: 0,
  index: 0,
  middle: 0,
  ring: 0,
  pinky: 0
});

/** One-hand C-major pentatonic layout (thumb → pinky) for UI labels — matches ebony stagger on the keyboard */
const PIANO_WHITE_KEY_NOTES = ["C", "D", "E", "F", "G"] as const;

function FingerTapPianoGame({ assignment, onComplete }: GameProps) {
  if (assignment.config.difficulty === "hard") {
    return <FingerTapPianoLanesGame assignment={assignment} onComplete={onComplete} />;
  }
  return <FingerTapPianoClassicGame assignment={assignment} onComplete={onComplete} />;
}

function FingerTapPianoClassicGame({ assignment, onComplete }: GameProps) {
  const input = usePatientInput();
  const sessionEvents = useGameEvents();
  const gloveControlsActive = input.rawConnected;
  const preset = useMemo(
    () => fingerTapPianoPreset(assignment),
    [assignment]
  );

  const [phase, setPhase] = useState<PianoPhase>("idle");
  const [play, setPlay] = useState<PianoPlayState>(() => ({
    currentTarget: "middle",
    hits: 0,
    misses: 0,
    streak: 0,
    bestStreak: 0,
    missesByFinger: emptyFingerCounts(),
    restEndsAt: null,
    timedOut: false
  }));

  const [paused, setPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [holdProgressMs, setHoldProgressMs] = useState(0);
  const [resultSent, setResultSent] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => loadPianoMuted());

  const processedEventRef = useRef("");
  /** `patient-input-*` taps from demo stream look like taps; only accept those from piano keys (+ real glove IDs). */
  const pianoTrustedLocalTapIdsRef = useRef<Set<string>>(new Set());
  const gameStartedAtRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const lastWrongAtRef = useRef(0);
  const pointerPressRef = useRef<{ finger: FingerName; start: number } | null>(null);
  /** Prevents duplicate counts when both pointerdown+click fire (mobile / some browsers). */
  const quickTapGuardRef = useRef(0);
  const targetRef = useRef(play.currentTarget);
  const phaseRef = useRef(phase);
  const pulseTimerRef = useRef<number | undefined>(undefined);
  const [fingerPulse, setFingerPulse] = useState<{ finger: FingerName; kind: "correct" | "wrong" } | null>(null);
  const [keyboardPressedFinger, setKeyboardPressedFinger] = useState<FingerName | null>(null);

  phaseRef.current = phase;
  targetRef.current = play.currentTarget;

  const inRest =
    play.restEndsAt !== null &&
    typeof performance !== "undefined" &&
    performance.now() < play.restEndsAt;
  const restRemainingSec =
    play.restEndsAt !== null ? Math.max(0, Math.ceil((play.restEndsAt - performance.now()) / 1000)) : 0;

  const accuracy =
    phase === "idle"
      ? null
      : clampPercent((play.hits / Math.max(play.hits + play.misses, 1)) * 100);
  const holdRequired = preset.holdRequiredMs > 0;

  const scheduleFingerPulse = useCallback((finger: FingerName, kind: "correct" | "wrong") => {
    window.clearTimeout(pulseTimerRef.current);
    setFingerPulse({ finger, kind });
    pulseTimerRef.current = window.setTimeout(() => {
      setFingerPulse(null);
      pulseTimerRef.current = undefined;
    }, 420);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(pulseTimerRef.current);
    },
    []
  );

  const finalizeToParent = useCallback(
    (snapshot: PianoPlayState) => {
      if (completedRef.current || resultSent) return;
      completedRef.current = true;
      setResultSent(true);
      const start = gameStartedAtRef.current ?? Date.now();
      const timeTakenSeconds = Math.max(1, Math.round((Date.now() - start) / 1000));
      const total = snapshot.hits + snapshot.misses;
      const acc = clampPercent((snapshot.hits / Math.max(total, 1)) * 100);
      const sortedMisses = Object.entries(snapshot.missesByFinger).sort((a, b) => b[1] - a[1]);
      const weakest =
        snapshot.misses > 0 && (sortedMisses[0]?.[1] ?? 0) > 0
          ? (sortedMisses[0][0] as FingerName)
          : undefined;

      onComplete({
        repsCompleted: snapshot.hits,
        successfulReps: snapshot.hits,
        failedAttempts: snapshot.misses,
        accuracy: acc,
        timeTakenSeconds,
        bestStreak: snapshot.bestStreak,
        weakestFinger: weakest,
        events: sessionEvents,
        gameMetrics: {
          hits: snapshot.hits,
          misses: snapshot.misses,
          bestStreak: snapshot.bestStreak,
          missesByFinger: snapshot.missesByFinger,
          holdRequiredMs: preset.holdRequiredMs,
          inputSource: gloveControlsActive ? "glove" : "demo"
        }
      });
    },
    [gloveControlsActive, onComplete, preset.holdRequiredMs, resultSent, sessionEvents]
  );

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((value) => {
      const next = !value;
      storePianoMuted(next);
      return next;
    });
  }, []);

  const beginRound = useCallback(() => {
    void unlockPianoAudio();
    completedRef.current = false;
    setResultSent(false);
    gameStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setHoldProgressMs(0);
    setPaused(false);
    processedEventRef.current = "";
    pianoTrustedLocalTapIdsRef.current.clear();
    setPlay({
      currentTarget: nextRandomFinger(),
      hits: 0,
      misses: 0,
      streak: 0,
      bestStreak: 0,
      missesByFinger: emptyFingerCounts(),
      restEndsAt: null,
      timedOut: false
    });
    setPhase("playing");
  }, []);

  const restartFromComplete = useCallback(() => {
    setPhase("idle");
    completedRef.current = false;
    setResultSent(false);
    gameStartedAtRef.current = null;
    setElapsedSeconds(0);
    setPlay({
      currentTarget: "middle",
      hits: 0,
      misses: 0,
      streak: 0,
      bestStreak: 0,
      missesByFinger: emptyFingerCounts(),
      restEndsAt: null,
      timedOut: false
    });
  }, []);

  /** Natural win — complete when enough correct taps (not time-limited loss). */
  useEffect(() => {
    if (phase !== "playing") return;
    if (play.timedOut) return;
    if (play.hits < preset.requiredHits) return;
    setPhase("complete");
  }, [phase, play.hits, play.timedOut, preset.requiredHits]);

  const registerCorrect = useCallback(() => {
    setPlay((prev) => {
      if (phaseRef.current !== "playing") return prev;
      if (prev.restEndsAt !== null && performance.now() < prev.restEndsAt) return prev;

      const nextHits = prev.hits + 1;
      const nextStreak = prev.streak + 1;
      const nextBest = Math.max(prev.bestStreak, nextStreak);

      if (nextHits >= preset.requiredHits) {
        return {
          ...prev,
          hits: nextHits,
          streak: nextStreak,
          bestStreak: nextBest,
          restEndsAt: null,
          timedOut: false
        };
      }

      const needsRest =
        preset.restSeconds > 0 &&
        preset.restEveryHits > 0 &&
        nextHits > 0 &&
        nextHits % preset.restEveryHits === 0;

      if (needsRest) {
        return {
          ...prev,
          hits: nextHits,
          streak: nextStreak,
          bestStreak: nextBest,
          restEndsAt: performance.now() + preset.restSeconds * 1000
        };
      }

      return {
        ...prev,
        hits: nextHits,
        streak: nextStreak,
        bestStreak: nextBest,
        currentTarget: nextRandomFinger(prev.currentTarget)
      };
    });
    setHoldProgressMs(0);
  }, [preset]);

  const registerWrong = useCallback(() => {
    const now = Date.now();
    if (now - lastWrongAtRef.current < 280) return;
    lastWrongAtRef.current = now;

    setPlay((prev) => {
      if (phaseRef.current !== "playing") return prev;
      if (prev.restEndsAt !== null && performance.now() < prev.restEndsAt) return prev;
      const target = prev.currentTarget;
      return {
        ...prev,
        misses: prev.misses + 1,
        streak: 0,
        missesByFinger: { ...prev.missesByFinger, [target]: prev.missesByFinger[target] + 1 }
      };
    });
    setHoldProgressMs(0);
  }, []);

  useEffect(() => {
    if (phase !== "playing" || paused || !play.restEndsAt) return;
    const id = window.setInterval(() => {
      setPlay((prev) => {
        if (!prev.restEndsAt) return prev;
        if (performance.now() < prev.restEndsAt) return prev;
        return {
          ...prev,
          restEndsAt: null,
          currentTarget: nextRandomFinger(prev.currentTarget)
        };
      });
    }, 280);
    return () => window.clearInterval(id);
  }, [phase, paused, play.restEndsAt]);

  useEffect(() => {
    if (phase !== "playing" || paused || inRest) return;
    const id = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase, paused, inRest]);

  useEffect(() => {
    if (phase !== "playing" || paused || inRest) return;
    if (preset.timeLimitSeconds == null) return;
    if (elapsedSeconds < preset.timeLimitSeconds) return;

    setPlay((prev) => ({ ...prev, timedOut: true }));
    setPhase("complete");
  }, [elapsedSeconds, inRest, paused, phase, preset.timeLimitSeconds]);

  useEffect(() => {
    if (phase !== "playing" || paused || inRest || (holdRequired && !gloveControlsActive)) return;
    const LOCAL_PREFIX = "patient-input-";
    const localTapCountsForGameplay = (event: GestureEvent) => {
      if (!event.gesture.startsWith("tap_")) return false;
      if (!event.id.startsWith(LOCAL_PREFIX)) return true;
      if (gloveControlsActive) return false;
      return pianoTrustedLocalTapIdsRef.current.has(event.id);
    };

    let guard = 0;
    while (guard < 320) {
      guard += 1;
      let tapEvent: GestureEvent | undefined;
      for (let i = input.events.length - 1; i >= 0; i -= 1) {
        const e = input.events[i];
        if (!e?.gesture.startsWith("tap_") || e.id === processedEventRef.current) continue;
        tapEvent = e;
        break;
      }
      if (!tapEvent) return;
      processedEventRef.current = tapEvent.id;

      if (!localTapCountsForGameplay(tapEvent)) {
        continue;
      }
      pianoTrustedLocalTapIdsRef.current.delete(tapEvent.id);

      const tapped =
        fingerFromTapGestureName(tapEvent.gesture as GestureName) ??
        strongestFingerFromBends(bendsFromGestureEvent(tapEvent));

      if (tapped === play.currentTarget) {
        scheduleFingerPulse(tapped, "correct");
        playPianoSound(tapped, "correct", soundMuted);
        registerCorrect();
      } else {
        scheduleFingerPulse(tapped, "wrong");
        playPianoSound(tapped, "wrong", soundMuted);
        registerWrong();
      }
      return;
    }
  }, [
    holdRequired,
    gloveControlsActive,
    inRest,
    input.events,
    paused,
    phase,
    play.currentTarget,
    registerCorrect,
    registerWrong,
    scheduleFingerPulse,
    soundMuted
  ]);

  /** Hold meter + scoring use key press duration only. `input.fingerBends` is driven by the global demo glove stream and jittered wildly, which caused phantom misses, pulses, and rapid advances when hold mode polled bends. */
  useEffect(() => {
    if (!holdRequired || phase !== "playing" || paused || inRest) return;
    const tick = window.setInterval(() => {
      const press = pointerPressRef.current;
      if (!press) {
        setHoldProgressMs(0);
        return;
      }
      const elapsed = performance.now() - press.start;
      setHoldProgressMs(Math.min(elapsed, preset.holdRequiredMs));
    }, 45);
    return () => window.clearInterval(tick);
  }, [holdRequired, paused, phase, inRest, preset.holdRequiredMs]);

  const onKeyPointerDown = (finger: FingerName) => {
    pointerPressRef.current = { finger, start: performance.now() };
  };

  /** Quick-tap mode: activate on pointer down so taps aren't lost before click (especially on touch). */
  const tryQuickTapFromPointer = useCallback(
    (finger: FingerName) => {
      if (holdRequired) return;
      if (phase !== "playing" || paused || inRest) return;
      if (gloveControlsActive) return;
      const now = performance.now();
      if (now - quickTapGuardRef.current < 55) return;
      quickTapGuardRef.current = now;
      const ev = emitFingerTap(finger, input.emitGesture);
      pianoTrustedLocalTapIdsRef.current.add(ev.id);
    },
    [gloveControlsActive, holdRequired, phase, paused, inRest, input.emitGesture]
  );

  const onKeyPointerUp = (finger: FingerName) => {
    const press = pointerPressRef.current;
    pointerPressRef.current = null;
    if (phase !== "playing" || paused || inRest) return;

    if (!holdRequired) {
      return;
    }

    if (!press || press.finger !== finger) return;
    const heldMs = performance.now() - press.start;
    if (heldMs < preset.holdRequiredMs) return;
    const target = targetRef.current;
    if (finger === target) {
      scheduleFingerPulse(finger, "correct");
      playPianoSound(finger, "correct", soundMuted);
      registerCorrect();
    } else {
      scheduleFingerPulse(finger, "wrong");
      playPianoSound(finger, "wrong", soundMuted);
      registerWrong();
    }
  };

  const titleForPhase =
    phase === "idle"
      ? "Ready"
      : phase === "playing"
        ? paused
          ? "Paused"
          : inRest
            ? "Rest"
            : "Playing"
        : phase === "complete"
          ? play.timedOut
            ? "Time Ended"
            : "Finished"
          : "Finger Tap Piano";

  const progressPercent =
    phase === "idle"
      ? 0
      : clamp((play.hits / Math.max(preset.requiredHits, 1)) * 100, 0, 100);

  const inputModeLabel = gloveControlsActive ? "Glove connected" : "Demo controls";
  const holdModeLabel = holdRequired ? `${preset.holdRequiredMs} ms hold` : "Quick tap";
  const difficultyTitle = difficultyLabel(assignment.config.difficulty);

  const boardStatusText = paused
    ? "Gameplay is paused."
    : inRest
      ? `Brief rest · ${restRemainingSec}s remaining.`
      : `Target · ${PIANO_UI_FINGER[play.currentTarget]} · ${play.hits}/${preset.requiredHits} taps`;

  const assistiveBrief =
    phase === "idle"
      ? "Finger Tap Piano. Random targets. Tap Start when ready."
      : phase === "complete"
        ? "Round complete."
        : boardStatusText;

  return (
    <section className="finger-tap-piano-root" aria-label="Finger Tap Piano session">
      <header className="piano-hero">
        <div className="piano-hero__row">
          <div className="piano-hero__brand">
            <h2 className="piano-hero__title">Finger Tap Piano</h2>
            <p className="piano-hero__summary">
              <span className="piano-hero__summary-strong">{preset.requiredHits} taps</span>
              <span className="piano-hero__dot" aria-hidden>
                ·
              </span>
              <span className="piano-hero__summary-strong">{difficultyTitle}</span>
              <span className="piano-hero__dot" aria-hidden>
                ·
              </span>
              <span>{inputModeLabel}</span>
              <span className="piano-hero__dot" aria-hidden>
                ·
              </span>
              <span>{holdModeLabel}</span>
            </p>
          </div>
          {(phase === "idle" || phase === "playing") && (
            <div className="piano-hero__cta">
              <button
                type="button"
                className="secondary-button piano-btn piano-btn--ghost"
                onClick={toggleSoundMuted}
                aria-pressed={!soundMuted}
                aria-label={soundMuted ? "Turn piano sound on" : "Mute piano sound"}
              >
                {soundMuted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
              </button>
              {phase === "idle" ? (
                <button type="button" className="primary-button piano-btn piano-btn--primary" onClick={beginRound}>
                  Start
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="secondary-button piano-btn piano-btn--ghost"
                    onClick={() => setPaused((value) => !value)}
                    aria-pressed={paused}
                  >
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button piano-btn piano-btn--ghost"
                    onClick={() => {
                      setPhase("idle");
                      setPaused(false);
                      gameStartedAtRef.current = null;
                      completedRef.current = false;
                      setResultSent(false);
                      setElapsedSeconds(0);
                      setPlay({
                        currentTarget: "middle",
                        hits: 0,
                        misses: 0,
                        streak: 0,
                        bestStreak: 0,
                        missesByFinger: emptyFingerCounts(),
                        restEndsAt: null,
                        timedOut: false
                      });
                    }}
                  >
                    Restart
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {phase !== "complete" ? (
          <>
            <div
              className="piano-hero-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
              aria-valuetext={
                phase === "idle"
                  ? `Goal ${preset.requiredHits} taps`
                  : `${play.hits} of ${preset.requiredHits} complete`
              }
            >
              <div className="piano-hero-progress__rail">
                <div className="piano-hero-progress__fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="piano-hero-progress__caption">
                {phase === "idle" ? (
                  <>
                    Goal <strong>{preset.requiredHits}</strong> taps
                    {preset.timeLimitSeconds != null ? (
                      <>
                        {" "}
                        · session window <strong>{preset.timeLimitSeconds}s</strong>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    Done <strong>{play.hits}</strong> / <strong>{preset.requiredHits}</strong>
                  </>
                )}
              </div>
            </div>

            <div
              className="piano-metrics"
              aria-live="polite"
              role={phase === "idle" ? undefined : "status"}
            >
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Hits</span>
                <span className="piano-metrics__value">
                  {phase === "idle" ? "—" : `${play.hits}/${preset.requiredHits}`}
                </span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span
                  className="piano-metrics__label"
                  title="Accuracy = hits ÷ (hits + misses). Goes up when you score a tap; goes down when a miss is recorded."
                >
                  Accuracy
                </span>
                <span className="piano-metrics__value">{accuracy !== null ? `${accuracy}%` : "—"}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span
                  className="piano-metrics__label"
                  title="Counts wrong presses scored against the current cue (not early releases in hold mode)."
                >
                  Misses
                </span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : play.misses}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Streak</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : play.streak}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Best</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : play.bestStreak}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Time</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : `${elapsedSeconds}s`}</span>
              </div>
              {preset.timeLimitSeconds != null ? (
                <>
                  <span className="piano-metrics__sep piano-metrics__sep--accent" aria-hidden />
                  <div className="piano-metrics__item piano-metrics__item--time">
                    <span className="piano-metrics__label">Time left</span>
                    <span className="piano-metrics__value">
                      {phase === "idle" ? "—" : `${Math.max(0, preset.timeLimitSeconds - elapsedSeconds)}s`}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <div className="piano-metrics piano-metrics--final" aria-live="polite">
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Hits</span>
              <span className="piano-metrics__value">
                {play.hits}/{preset.requiredHits}
              </span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span
                className="piano-metrics__label"
                title="hits ÷ (hits + misses) over this round."
              >
                Accuracy
              </span>
              <span className="piano-metrics__value">
                {clampPercent((play.hits / Math.max(play.hits + play.misses, 1)) * 100)}%
              </span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Misses</span>
              <span className="piano-metrics__value">{play.misses}</span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Best</span>
              <span className="piano-metrics__value">{play.bestStreak}</span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Time</span>
              <span className="piano-metrics__value">{elapsedSeconds}s</span>
            </div>
          </div>
        )}

        {phase === "idle" && (
          <details className="piano-plan-details">
            <summary className="piano-plan-details__summary">View assignment note</summary>
            <div className="piano-plan-details__body">
              <p>
                Clinician prescribed <strong>{assignment.config.targetReps}</strong> reps ·{" "}
                <span className="piano-plan-name">{assignment.name}</span>
              </p>
              <p>{assignment.doctorInstructions || "Follow your clinician’s guidance for pacing and rest."}</p>
            </div>
          </details>
        )}

        {phase === "idle" && (
          <ul className="piano-prep-micro" aria-label="Before you begin">
            <li>Tap Start—the board wakes for this round.</li>
            <li>{gloveControlsActive ? "Tap the highlighted finger with the glove." : "Only bend or tap the highlighted finger column."}</li>
            <li>Wrong finger adds a miss and clears your streak.</li>
          </ul>
        )}
      </header>

      <div className={`piano-playfield${phase === "complete" ? " piano-playfield--complete" : ""}`}>
          <div
            className={`piano-board ${phase === "idle" ? "piano-board--idle" : ""}`}
            aria-busy={inRest || paused || phase !== "playing"}
          >
            {phase === "playing" && (
              <div className="piano-board-head">
                <div className="piano-phase-row">
                  <span className="piano-status-pill">{titleForPhase}</span>
                  <p className={`piano-status-line ${inRest ? "is-rest" : paused ? "is-muted" : ""}`}>{boardStatusText}</p>
                </div>
                {holdRequired && phase === "playing" && !inRest && !paused && (
                  <div
                    className="piano-hold-meter"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={preset.holdRequiredMs}
                    aria-valuenow={Math.min(holdProgressMs, preset.holdRequiredMs)}
                    aria-label={`Hold ${preset.holdRequiredMs} milliseconds`}
                  >
                    <div
                      className="piano-hold-meter-fill"
                      style={{
                        width: `${clamp((holdProgressMs / preset.holdRequiredMs) * 100, 0, 100)}%`
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            <div
              className={`piano-keybed${inRest && phase === "playing" ? " piano-keybed--rest" : ""}`}
            >
              <div className="piano-keybed__rail" aria-hidden />
              <div className="piano-keybed__deck">
                <div className="piano-black-keys" aria-hidden>
                  <span className="piano-bk piano-bk--cd" />
                  <span className="piano-bk piano-bk--de" />
                  <span className="piano-bk piano-bk--fg" />
                </div>
                <div className="piano-white-keys">
                  {fingerNames.map((finger, keyIndex) => {
                    const isTarget = phase === "playing" && !paused && !inRest && play.currentTarget === finger;
                    const isLocked = phase !== "playing" || paused || inRest;
                    let flashCls = "";
                    if (fingerPulse?.finger === finger) {
                      flashCls = fingerPulse.kind === "correct" ? " is-flash-ok" : " is-flash-bad";
                    }
                    const isPressed =
                      keyboardPressedFinger === finger ||
                      (fingerPulse?.finger === finger && fingerPulse.kind === "correct");
                    return (
                      <button
                        key={finger}
                        type="button"
                        className={`piano-key piano-key--white${isTarget ? " is-target" : ""}${isLocked ? " is-muted" : ""}${flashCls}${isPressed ? " is-key-pressed" : ""}`}
                        aria-current={isTarget ? "step" : undefined}
                        aria-label={`${PIANO_UI_FINGER[finger]}, ${PIANO_WHITE_KEY_NOTES[keyIndex]}${isTarget ? ", current target" : ""}`}
                        disabled={isLocked}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if (phase !== "playing" || paused || inRest) return;
                          setKeyboardPressedFinger(finger);
                          if (gloveControlsActive) return;
                          if (holdRequired) {
                            (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
                            onKeyPointerDown(finger);
                            return;
                          }
                          e.preventDefault();
                          tryQuickTapFromPointer(finger);
                        }}
                        onPointerCancel={() => {
                          pointerPressRef.current = null;
                          setKeyboardPressedFinger(null);
                        }}
                        onPointerLeave={() => {
                          if (!holdRequired) setKeyboardPressedFinger(null);
                        }}
                        onPointerUp={(e) => {
                          setKeyboardPressedFinger(null);
                          if (holdRequired && phase === "playing" && !paused && !inRest) {
                            e.preventDefault();
                            onKeyPointerUp(finger);
                          }
                        }}
                        onClick={(e) => {
                          if (!holdRequired) e.preventDefault();
                        }}
                      >
                        <span className="piano-key-note">{PIANO_WHITE_KEY_NOTES[keyIndex]}</span>
                        <span className="piano-key-label">{PIANO_UI_FINGER[finger]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {paused && phase === "playing" && (
              <div className="piano-board-overlay piano-board-overlay--pause">Paused</div>
            )}
            {inRest && phase === "playing" && (
              <div className="piano-board-overlay piano-board-overlay--rest" role="status" aria-live="polite">
                Rest · {restRemainingSec}s
              </div>
            )}
          </div>

          {phase === "complete" && (
            <div className="piano-complete-wrap">
              <section className="piano-complete-card" aria-labelledby="piano-summary-title">
                <div className="piano-complete-card__banner">
                  <h3 id="piano-summary-title">{play.timedOut ? "Time Limit Reached" : "Round Complete"}</h3>
                  <p>
                    {play.timedOut
                      ? `${play.hits}/${preset.requiredHits} taps recorded before the session timer ended.`
                      : `${play.hits} correct taps · best streak ${play.bestStreak}. Continue when you are ready.`}
                  </p>
                </div>
                <div className="piano-complete-card__footer">
                  <button
                    type="button"
                    className="primary-button piano-btn piano-btn--primary"
                    onClick={() => finalizeToParent(play)}
                    disabled={resultSent}
                  >
                    Continue to Check-In
                  </button>
                  <button type="button" className="secondary-button piano-btn piano-btn--ghost" onClick={restartFromComplete}>
                    Back to Intro
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        <span className="piano-live-region" aria-live="polite">
          {assistiveBrief}
        </span>
      </section>
    );
}

const BUBBLE_SLOT_COORDS = [
  { x: 22, y: 26 },
  { x: 52, y: 20 },
  { x: 78, y: 26 },
  { x: 26, y: 52 },
  { x: 50, y: 56 },
  { x: 74, y: 52 }
];

/** Min distance between bubble centers (% of board w/h — same coords as gameplay). Keeps taps distinct. */
const MIN_BUBBLE_CENTER_DIST = 17;

/** Permute slots by seed so layouts vary without heavy overlap */
function bubbleSlotsForSeed(seed: number): typeof BUBBLE_SLOT_COORDS {
  const order = [0, 1, 2, 3, 4, 5];
  let s = Math.max(1, seed) * 73856093;
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 48271 + 65521) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((slotIdx) => BUBBLE_SLOT_COORDS[slotIdx]);
}

function jitteredBubblePoint(seed: number, slot: Point, index: number, margin: number): Point {
  const jx = (((seed << 3) + index * 47) % 1000) / 1000;
  const jy = (((seed * 11 + index * 71) % 1000) / 1000 - 0.5) * 3.2;
  return {
    x: clamp(slot.x + (jx - 0.5) * 3.2, margin, 100 - margin),
    y: clamp(slot.y + jy, margin, 100 - margin)
  };
}

function pairwiseMinDistOk(candidate: Point, placed: readonly Point[]): boolean {
  return placed.every((q) => distance(candidate, q) >= MIN_BUBBLE_CENTER_DIST);
}

/** Fallback: fixed anchors only (pairwise ≥ ~24 with this grid). */
function rawSlotCenters(seed: number, margin: number): Point[] {
  return bubbleSlotsForSeed(seed).map((slot) => ({
    x: clamp(slot.x, margin, 100 - margin),
    y: clamp(slot.y, margin, 100 - margin)
  }));
}

/** Resample jitter until all six centers are separated, else use raw anchors. */
function buildNonOverlappingLayout(seed: number, margin: number): Point[] {
  for (let world = 0; world < 96; world++) {
    const s = seed + world;
    const slots = bubbleSlotsForSeed(s);
    const pts: Point[] = [];
    let bad = false;
    for (let i = 0; i < 6; i++) {
      let p = jitteredBubblePoint(s, slots[i], i, margin);
      for (let guard = 0; guard < 56 && !pairwiseMinDistOk(p, pts); guard++) {
        const angle = (((s * 131 + i * 17 + guard * 53) >>> 0) % 360) * (Math.PI / 180);
        const step = 0.8 + (guard % 12) * 0.28;
        p = {
          x: clamp(p.x + Math.cos(angle) * step, margin, 100 - margin),
          y: clamp(p.y + Math.sin(angle) * step, margin, 100 - margin)
        };
      }
      if (!pairwiseMinDistOk(p, pts)) {
        bad = true;
        break;
      }
      pts.push(p);
    }
    if (!bad) return pts;
  }
  return rawSlotCenters(seed, margin);
}

function createBubblePopItem(seed: number, index: number, pos: Point) {
  const scaleJit = clamp(0.94 + ((((seed + index * 29) % 97) / 97) * 0.13), 0.94, 1.06);
  return {
    id: `bubble-${seed}-${index}-${Math.round(pos.x * 100)}-${Math.round(pos.y * 100)}`,
    x: pos.x,
    y: pos.y,
    target: index % 3 !== 1,
    floatPhase: index % 6,
    scaleJit
  };
}

function makeBubbles(seed: number) {
  const margin = 10;
  const pts = buildNonOverlappingLayout(seed, margin);
  return pts.map((pos, index) => createBubblePopItem(seed, index, pos));
}

/**
 * Spawn one bubble after another was removed; position must avoid existing centers.
 */
function makeReplacementBubble(seed: number, existingCenters: Point[]) {
  const margin = 10;

  function bestAnchorFromSlots(): Point {
    let pick: Point = { x: 50, y: 45 };
    let best = -1;
    for (const slot of BUBBLE_SLOT_COORDS) {
      const c = { x: clamp(slot.x, margin, 100 - margin), y: clamp(slot.y, margin, 100 - margin) };
      const d = existingCenters.length
        ? Math.min(...existingCenters.map((e) => distance(c, e)))
        : 99;
      if (d > best) {
        best = d;
        pick = c;
      }
    }
    return pick;
  }

  for (let world = 0; world < 128; world++) {
    const s = seed + world;
    const slots = bubbleSlotsForSeed(s);
    for (let si = 0; si < 6; si++) {
      for (let att = 0; att < 18; att++) {
        const t = s + si * 59 + att * 11;
        const p = jitteredBubblePoint(t, slots[si], si, margin);
        if (pairwiseMinDistOk(p, existingCenters)) {
          return createBubblePopItem(seed, 0, p);
        }
      }
    }
  }

  let p = bestAnchorFromSlots();
  for (let bump = 0; bump < 60 && !pairwiseMinDistOk(p, existingCenters); bump++) {
    const ang = ((seed + bump * 29) % 360) * (Math.PI / 180);
    const step = 1.2 + (bump % 7) * 0.45;
    p = {
      x: clamp(p.x + Math.cos(ang) * step, margin, 100 - margin),
      y: clamp(p.y + Math.sin(ang) * step, margin, 100 - margin)
    };
  }

  for (let iter = 0; iter < 40 && !pairwiseMinDistOk(p, existingCenters); iter++) {
    const tooClose = existingCenters.filter((o) => distance(p, o) < MIN_BUBBLE_CENTER_DIST);
    if (tooClose.length === 0) break;
    for (const o of tooClose) {
      const g = Math.max(distance(p, o), 1e-4);
      const need = MIN_BUBBLE_CENTER_DIST - g + 0.55;
      p = {
        x: clamp(p.x + ((p.x - o.x) / g) * need, margin, 100 - margin),
        y: clamp(p.y + ((p.y - o.y) / g) * need, margin, 100 - margin)
      };
    }
  }

  if (!pairwiseMinDistOk(p, existingCenters)) {
    for (const slot of BUBBLE_SLOT_COORDS) {
      const tryP = {
        x: clamp(slot.x, margin, 100 - margin),
        y: clamp(slot.y, margin, 100 - margin)
      };
      if (pairwiseMinDistOk(tryP, existingCenters)) {
        return createBubblePopItem(seed, 0, tryP);
      }
    }
  }

  return createBubblePopItem(seed, 0, p);
}

function BubblePopGame({ assignment, onComplete }: GameProps) {
  const input = usePatientInput();
  const sessionEvents = useGameEvents();
  const finish = useCompletion(onComplete);
  const processedEventRef = useRef("");
  const targetReps = assignment.config.targetReps;
  const initialTime = 50;
  const [phase, setPhase] = useState<"ready" | "playing" | "paused">("ready");
  const [bubbles, setBubbles] = useState(() => makeBubbles(1));
  const [seed, setSeed] = useState(2);
  const [popped, setPopped] = useState(0);
  const [missed, setMissed] = useState(0);
  const [timeLeft, setTimeLeft] = useState(initialTime);
  const [tapFx, setTapFx] = useState<Partial<Record<string, "ok" | "bad">>>({});
  const lastSuccessfulPopAtRef = useRef<number | null>(null);
  const popIntervalsRef = useRef<number[]>([]);
  const popRadius = 10;
  /** Half-diameter in normalized 0–100 coords; matches ~clamp(72px, 10vw, 120px) bubbles on typical boards */
  const bubbleHitHalf = 7;

  const progressPct = clamp((popped / Math.max(targetReps, 1)) * 100, 0, 100);
  const gameActive = phase === "playing";

  const resetRound = useCallback(() => {
    processedEventRef.current = "";
    lastSuccessfulPopAtRef.current = null;
    popIntervalsRef.current = [];
    setSeed(2);
    setBubbles(makeBubbles(1));
    setPopped(0);
    setMissed(0);
    setTimeLeft(initialTime);
    setTapFx({});
  }, [initialTime]);

  const startRound = useCallback(() => {
    resetRound();
    setPhase("playing");
  }, [resetRound]);

  const finishBubbleRound = useCallback(
    (nextPopped: number, nextMissed: number) => {
      const intervals = popIntervalsRef.current;
      const averagePopIntervalMs = intervals.length
        ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
        : null;
      finish({
        repsCompleted: nextPopped,
        successfulReps: nextPopped,
        failedAttempts: nextMissed,
        accuracy: clampPercent((nextPopped / Math.max(nextPopped + nextMissed, 1)) * 100),
        weakestFinger: sessionEvents.length ? weakestFingerFromEvents(sessionEvents) : undefined,
        events: sessionEvents,
        gameMetrics: {
          popped: nextPopped,
          wrongHits: nextMissed,
          timeLeft,
          averagePopIntervalMs,
          inputSource: input.rawConnected ? "glove" : "demo"
        }
      });
    },
    [finish, input.rawConnected, sessionEvents, timeLeft]
  );

  const flashTap = useCallback((bubbleId: string, kind: "ok" | "bad") => {
    setTapFx((prev) => ({ ...prev, [bubbleId]: kind }));
    window.setTimeout(() => {
      setTapFx((prev) => {
        const next = { ...prev };
        delete next[bubbleId];
        return next;
      });
    }, 380);
  }, []);

  const emitPinchFromBubble = useCallback(
    (bubble: { id: string; x: number; y: number; target: boolean }) => {
      if (!gameActive || input.rawConnected) return;
      flashTap(bubble.id, bubble.target ? "ok" : "bad");
      input.emitGesture("pinch", gestureTargets.pinch, { x: bubble.x, y: bubble.y, z: 0 });
    },
    [flashTap, gameActive, input]
  );

  useEffect(() => {
    if (phase !== "playing") return undefined;
    const timer = window.setInterval(() => setTimeLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (timeLeft > 0 || popped >= targetReps) return;
    if (phase !== "playing") return;
    finishBubbleRound(popped, missed);
  }, [finishBubbleRound, missed, phase, popped, targetReps, timeLeft]);

  useEffect(() => {
    if (phase !== "playing") return;
    const event = input.events[0];
    if (!event || processedEventRef.current === event.id) return;
    if (event.gesture !== "pinch" && event.gesture !== "point") return;
    processedEventRef.current = event.id;

    const nearest = bubbles
      .map((bubble) => ({ bubble, gap: distance(bubble, input.handPosition) }))
      .filter(({ gap }) => gap <= bubbleHitHalf + popRadius)
      .sort((a, b) => a.gap - b.gap)[0]?.bubble;
    if (!nearest) return;

    const nextSeed = seed + 1;
    setSeed(nextSeed);
    setBubbles((items) => {
      const rest = items.filter((bubble) => bubble.id !== nearest.id);
      const centers = rest.map(({ x, y }) => ({ x, y }));
      const incoming = makeReplacementBubble(nextSeed, centers);
      return [...rest, incoming];
    });

    if (nearest.target) {
      const nextPopped = popped + 1;
      const now = Date.now();
      if (lastSuccessfulPopAtRef.current !== null) {
        popIntervalsRef.current = [...popIntervalsRef.current, now - lastSuccessfulPopAtRef.current].slice(-40);
      }
      lastSuccessfulPopAtRef.current = now;
      setPopped(nextPopped);
      if (nextPopped >= targetReps) {
        finishBubbleRound(nextPopped, missed);
      }
    } else {
      setMissed((value) => value + 1);
    }
  }, [
    bubbles,
    finishBubbleRound,
    input.events,
    input.handPosition,
    missed,
    popRadius,
    popped,
    seed,
    phase,
    bubbleHitHalf,
    targetReps
  ]);

  useEffect(() => {
    if (phase !== "playing") return undefined;
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const direction = {
        x: key === "arrowleft" || key === "a" ? -1 : key === "arrowright" || key === "d" ? 1 : 0,
        y: key === "arrowup" || key === "w" ? -1 : key === "arrowdown" || key === "s" ? 1 : 0
      };
      if (!direction.x && !direction.y) return;
      event.preventDefault();
      const step = 6;
      input.setHandPosition({
        x: input.handPosition.x + direction.x * step,
        y: input.handPosition.y + direction.y * step,
        z: 0
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input, phase]);

  return (
    <section className="bubble-pop-shell" aria-label="Bubble Pop game">
      <header className="bubble-pop-hud">
        <div className="bubble-pop-hud__top">
          <div className="bubble-pop-hud__brand">
            <span className="bubble-pop-hud__icon-wrap" aria-hidden>
              <Sparkles size={20} strokeWidth={2} />
            </span>
            <div>
              <h2 className="bubble-pop-hud__title">{assignment.name}</h2>
              <p className="bubble-pop-hud__sub">{difficultyLabel(assignment.config.difficulty)} · {targetReps} pop goal</p>
            </div>
          </div>
          <dl className="bubble-pop-stat-chips">
            <div className="bubble-pop-stat-chips__item bubble-pop-stat-chips__item--pop">
              <dt>Popped</dt>
              <dd>
                {popped} / {targetReps}
              </dd>
            </div>
            <div className="bubble-pop-stat-chips__item bubble-pop-stat-chips__item--risk">
              <dt>Wrong</dt>
              <dd>{missed}</dd>
            </div>
            <div className="bubble-pop-stat-chips__item bubble-pop-stat-chips__item--time">
              <dt>Left</dt>
              <dd>{timeLeft}s</dd>
            </div>
          </dl>
          <div className="bubble-pop-actions">
            {phase === "ready" ? (
              <button type="button" className="primary-button compact-game-button" onClick={startRound}>Start</button>
            ) : (
              <button type="button" className="secondary-button compact-game-button" onClick={() => setPhase((value) => value === "paused" ? "playing" : "paused")}>
                {phase === "paused" ? "Resume" : "Pause"}
              </button>
            )}
            <button type="button" className="secondary-button compact-game-button" onClick={startRound}>Restart</button>
            <button type="button" className="danger-button compact-game-button" disabled={phase === "ready"} onClick={() => finishBubbleRound(popped, missed)}>End</button>
          </div>
        </div>
        <div className="bubble-pop-meta-chips">
          <span className="bubble-meta-chip">Crosshair aim · pinch or tap confirms</span>
          <span className="bubble-meta-chip">{gestureLabels[input.currentGesture]} focus</span>
        </div>
        <div
          className="bubble-pop-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={targetReps}
          aria-valuenow={Math.min(popped, targetReps)}
          aria-valuetext={`${popped} of ${targetReps} bubbles`}
        >
          <div className="bubble-pop-progress__fill" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div
        className="bubble-pop-scene bubble-board game-board"
        onPointerMove={(event) => {
          if (phase !== "playing") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          input.setHandPosition({
            x: ((event.clientX - bounds.left) / bounds.width) * 100,
            y: ((event.clientY - bounds.top) / bounds.height) * 100,
            z: 0
          });
        }}
      >
        <div className="bubble-pop-bg-layer" aria-hidden>
          {[0.05, 0.068, 0.04, 0.056].map((o, idx) => (
            <span
              key={`bg-drift-${idx}`}
              className={`bubble-pop-bg-drift bubble-pop-bg-drift--${idx + 1}`}
              style={{ opacity: o }}
            />
          ))}
          {[
            { l: 8, t: 78, px: 18 },
            { l: 44, t: 10, px: 12 },
            { l: 88, t: 42, px: 16 },
            { l: 6, t: 36, px: 10 },
            { l: 72, t: 18, px: 11 },
            { l: 30, t: 86, px: 14 },
            { l: 92, t: 72, px: 9 },
            { l: 54, t: 8, px: 11 }
          ].map(({ l, t, px }, i) => (
            <span
              key={`mote-${i}`}
              className="bubble-pop-bg-mote"
              style={{ left: `${l}%`, top: `${t}%`, width: px, height: px, opacity: 0.1 + (i % 4) * 0.022 }}
            />
          ))}
        </div>

        <div className="bubble-pop-depth-grid" aria-hidden />

        <div className="bubble-pop-surface" aria-hidden>
          <svg className="bubble-pop-surface__wave" viewBox="0 0 480 72" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bubblePopRippleTone" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(186,230,253,0.38)" />
                <stop offset="100%" stopColor="rgba(191,219,254,0.16)" />
              </linearGradient>
            </defs>
            <path
              d="M0 54 C76 72 154 42 238 54 C324 67 394 42 478 62 L478 144 L0 144 Z"
              fill="url(#bubblePopRippleTone)"
              opacity="0.9"
            />
            <path d="M0 52 C118 74 258 42 478 62" stroke="rgba(148,163,184,0.42)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        </div>

        <div className="bubble-pop-bubbles-layer">
          {bubbles.map((bubble) => {
            const fx = tapFx[bubble.id];
            return (
              <button
                key={bubble.id}
                type="button"
                className={`bubble-pop-hit ${bubble.target ? "bubble-pop-hit--target" : "bubble-pop-hit--decoy"}${fx === "ok" ? " bubble-pop-hit--fx-ok" : ""}${fx === "bad" ? " bubble-pop-hit--fx-bad" : ""}`}
                style={
                  {
                    left: `${bubble.x}%`,
                    top: `${bubble.y}%`,
                    ["--bubble-float-delay" as string]: `${bubble.floatPhase * -0.32}s`,
                    ["--bubble-scale" as string]: String(bubble.scaleJit)
                  } as CSSProperties
                }
                onClick={(e) => {
                  e.stopPropagation();
                  emitPinchFromBubble(bubble);
                }}
              >
                <span className="bubble-pop-hit__shell" aria-hidden />
                <span className={`bubble-pop-sparkfx${fx === "ok" ? " is-on" : ""}`} aria-hidden />
                <span className="bubble-pop-hit__content">
                  <span className={`bubble-pop-hit__lbl${bubble.target ? "" : " bubble-pop-hit__lbl--decoy"}`} aria-hidden>
                    {bubble.target ? "Pop" : "Avoid"}
                  </span>
                  <span className="bubble-pop-visually-hidden">
                    {bubble.target ? "Correct glowing bubble — pop this target" : "Coral-styled decoy — do not tap"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <BubblePopAimCursor position={input.handPosition} gesture={input.currentGesture} />
        {phase === "ready" && (
          <div className="bubble-pop-overlay">
            <div>
              <h3>Ready to Pop</h3>
              <p>{input.rawConnected ? "Aim with the pointer, then point or pinch with the glove." : "Aim and tap targets for demo mode."}</p>
              <button type="button" className="primary-button" onClick={startRound}>Start Bubble Pop</button>
            </div>
          </div>
        )}
        {phase === "paused" && (
          <div className="bubble-pop-overlay">
            <div>
              <h3>Paused</h3>
              <button type="button" className="primary-button" onClick={() => setPhase("playing")}>Resume</button>
            </div>
          </div>
        )}
      </div>

      <p className="bubble-pop-hint-chip" role="note">
        Aim crosshair · pinch or tap glowing targets — coral = decoys.
      </p>
    </section>
  );
}

type CarromStage = "start" | "playing" | "ended";
type CarromPlayer = "player" | "ai";
type CarromCoin = "white" | "black" | "queen" | "striker";
type CarromDragMode = "place" | "aim" | null;
type CarromPiece = {
  id: string;
  coin: CarromCoin;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pocketed: boolean;
  pocketedBy?: CarromPlayer;
  fouled?: boolean;
  touchedCoin?: boolean;
  touchedCoinType?: CarromCoin;
};
type CarromAim = { angle: number; power: number };
type QueenState = { status: "available" | "pending" | "covered"; holder?: CarromPlayer };
type ShotResult = {
  nextPieces: CarromPiece[];
  nextQueen: QueenState;
  nextTurn: CarromPlayer;
  message: string;
  foul: boolean;
  playerFoul: boolean;
  playerMiss: boolean;
  winner: CarromPlayer | null;
};

const playerCoin: CarromCoin = "white";
const aiCoin: CarromCoin = "black";

const carromBoard = {
  // Full rendered board/model extent. Pointer mapping and model fitting use this.
  half: 3.2,
  // Playable inner square. Physics walls use this so coins cannot leave the board surface.
  playHalf: 2.68,
  pocketCenter: 2.54,
  strikerY: 2.22,
  aiStrikerY: -2.22,
  baselineMinX: -1.98,
  baselineMaxX: 1.98,
  baselineSnapDistance: 0.28,
  pocketRadius: 0.28,
  pieceRadius: 0.13,
  strikerRadius: 0.19,
  maxPower: 11.5
};

const carromPockets = [
  { x: -carromBoard.pocketCenter, y: -carromBoard.pocketCenter },
  { x: carromBoard.pocketCenter, y: -carromBoard.pocketCenter },
  { x: -carromBoard.pocketCenter, y: carromBoard.pocketCenter },
  { x: carromBoard.pocketCenter, y: carromBoard.pocketCenter }
];

function ownerCoin(owner: CarromPlayer): CarromCoin {
  return owner === "player" ? playerCoin : aiCoin;
}

function opponent(owner: CarromPlayer): CarromPlayer {
  return owner === "player" ? "ai" : "player";
}

function createCarromPieces(): CarromPiece[] {
  const coin = (id: string, coinType: CarromCoin, x: number, y: number): CarromPiece => ({
    id,
    coin: coinType,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: coinType === "striker" ? carromBoard.strikerRadius : carromBoard.pieceRadius,
    pocketed: false
  });
  const positions = [
    { x: 0, y: -0.31 },
    { x: 0.27, y: -0.16 },
    { x: 0.27, y: 0.16 },
    { x: 0, y: 0.31 },
    { x: -0.27, y: 0.16 },
    { x: -0.27, y: -0.16 },
    { x: 0, y: -0.62 },
    { x: 0.54, y: -0.31 },
    { x: 0.54, y: 0.31 },
    { x: 0, y: 0.62 },
    { x: -0.54, y: 0.31 },
    { x: -0.54, y: -0.31 },
    { x: 0.27, y: -0.47 },
    { x: 0.27, y: 0.47 },
    { x: -0.27, y: 0.47 },
    { x: -0.27, y: -0.47 },
    { x: 0.54, y: 0 },
    { x: -0.54, y: 0 }
  ];
  return [
    coin("striker", "striker", 0, carromBoard.strikerY),
    coin("queen", "queen", 0, 0),
    ...positions.map((position, index) => coin(`${index % 2 === 0 ? "white" : "black"}-${Math.floor(index / 2) + 1}`, index % 2 === 0 ? "white" : "black", position.x, position.y))
  ];
}

function carromAccuracy(successes: number, misses: number, fouls: number) {
  return clampPercent((successes / Math.max(successes + misses + fouls, 1)) * 100);
}

function piecesAreMoving(pieces: CarromPiece[]) {
  return pieces.some((piece) => !piece.pocketed && Math.hypot(piece.vx, piece.vy) > 0.035);
}

function nearestPocket(piece: CarromPiece) {
  return carromPockets.reduce((best, pocket) => {
    const gap = Math.hypot(piece.x - pocket.x, piece.y - pocket.y);
    const bestGap = Math.hypot(piece.x - best.x, piece.y - best.y);
    return gap < bestGap ? pocket : best;
  }, carromPockets[0]);
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function chooseAiShot(
  pieces: CarromPiece[],
  queen: QueenState,
  difficulty: PatientCareAssignment["config"]["difficulty"]
): { aim: CarromAim; strikerX: number; signature: string } | null {
  const isEasy = difficulty === "easy";
  const isHard = difficulty === "hard";

  const randomScore = isEasy ? 0.95 : isHard ? 0.22 : 0.55;
  const strikerXJitter = isEasy ? 0.44 : isHard ? 0.18 : 0.28;
  const aimNoiseAngle = isEasy ? 0.18 : isHard ? 0.04 : 0.095;
  const powerScale = isEasy ? 0.88 : isHard ? 1 : 0.95;

  const ownTargets = pieces.filter((piece) => piece.coin === aiCoin && !piece.pocketed);
  const queenPiece = pieces.find((piece) => piece.coin === "queen" && !piece.pocketed);
  const targets = queen.status === "pending" && queen.holder === "ai"
    ? ownTargets
    : queen.status === "available" && ownTargets.length <= 3 && queenPiece
      ? [queenPiece, ...ownTargets]
      : ownTargets.length ? ownTargets : queenPiece ? [queenPiece] : [];

  // On easier difficulties the AI considers fewer candidates and adds more noise.
  const candidateTargets = targets
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(isEasy ? 2 : isHard ? Math.min(6, targets.length) : Math.min(4, targets.length));

  let best: { aim: CarromAim; strikerX: number; score: number; signature: string } | null = null;
  for (const target of candidateTargets) {
    for (const [pocketIndex, pocket] of carromPockets.entries()) {
      const pocketDx = pocket.x - target.x;
      const pocketDy = pocket.y - target.y;
      const pocketDistance = Math.max(0.1, Math.hypot(pocketDx, pocketDy));
      const contact = {
        x: target.x - (pocketDx / pocketDistance) * (carromBoard.pieceRadius + carromBoard.strikerRadius),
        y: target.y - (pocketDy / pocketDistance) * (carromBoard.pieceRadius + carromBoard.strikerRadius)
      };
      const strikerX = clamp(contact.x + (Math.random() - 0.5) * strikerXJitter, carromBoard.baselineMinX, carromBoard.baselineMaxX);
      const strikerPoint = { x: strikerX, y: carromBoard.aiStrikerY };
      const angleBase = Math.atan2(contact.y - strikerPoint.y, contact.x - strikerPoint.x);
      const angle = angleBase + (Math.random() - 0.5) * aimNoiseAngle;
      const shotDistance = distance(strikerPoint, contact);
      const blockers = pieces.filter((piece) =>
        !piece.pocketed &&
        piece.id !== target.id &&
        piece.coin !== "striker" &&
        (distanceToSegment(piece, strikerPoint, contact) < piece.radius * 1.7 || distanceToSegment(piece, target, pocket) < piece.radius * 1.5)
      ).length;
      const cutPenalty = Math.abs(Math.sin(angle - Math.atan2(pocketDy, pocketDx))) * 1.35;
      const queenBonus = target.coin === "queen" ? 0.35 : 0;
      const score = 4 - shotDistance * 0.28 - pocketDistance * 0.18 - blockers * 1.2 - cutPenalty + queenBonus + Math.random() * randomScore;
      const power = clamp((0.66 + shotDistance / 8 + blockers * 0.04 + Math.random() * 0.08) * powerScale, 0.52, 1);
      const signature = `${target.id}|${pocketIndex}|${Math.round(angle * 1000) / 1000}|${Math.round(strikerX * 1000) / 1000}`;
      if (!best || score > best.score) best = { strikerX, aim: { angle, power }, score, signature };
    }
  }

  return best ? { aim: best.aim, strikerX: best.strikerX, signature: best.signature } : null;
}

function resetCoinNearCenter(piece: CarromPiece, pieces: CarromPiece[], offset = 0) {
  const occupied = pieces.filter((item) => !item.pocketed && item.id !== piece.id);
  const spots = [
    { x: 0, y: 0 },
    { x: 0.32, y: 0 },
    { x: -0.32, y: 0 },
    { x: 0, y: 0.32 },
    { x: 0, y: -0.32 },
    { x: 0.45, y: 0.45 },
    { x: -0.45, y: -0.45 },
    { x: 0.45, y: -0.45 },
    { x: -0.45, y: 0.45 }
  ];
  const spot = spots.slice(offset).find((candidate) => occupied.every((item) => Math.hypot(item.x - candidate.x, item.y - candidate.y) > 0.34)) ?? spots[0];
  piece.x = spot.x;
  piece.y = spot.y;
  piece.vx = 0;
  piece.vy = 0;
  piece.pocketed = false;
  piece.pocketedBy = undefined;
}

function applyPenalty(owner: CarromPlayer, pieces: CarromPiece[]) {
  // On foul: return pocketed coins back onto the board.
  // (We return both colors to avoid edge cases where the opponent pockets
  // coins during a foul but the game state doesn't reflect that.)
  const penaltyCoins = pieces.filter((piece) => (piece.coin === "white" || piece.coin === "black") && piece.pocketed);
  penaltyCoins.forEach((penaltyCoin, i) => resetCoinNearCenter(penaltyCoin, pieces, i));
}

function resetStrikerFor(owner: CarromPlayer, pieces: CarromPiece[], x = 0) {
  return pieces.map((piece) => piece.coin === "striker"
    ? {
        ...piece,
        x: clamp(x, carromBoard.baselineMinX, carromBoard.baselineMaxX),
        y: owner === "player" ? carromBoard.strikerY : carromBoard.aiStrikerY,
        vx: 0,
        vy: 0,
        pocketed: false,
        fouled: false,
        touchedCoin: false,
        touchedCoinType: undefined
      }
    : piece);
}

function stepCarromPhysics(pieces: CarromPiece[]) {
  const next = pieces.map((piece) => ({ ...piece }));
  const limit = carromBoard.half - 0.2;

  for (const piece of next) {
    if (piece.pocketed) continue;
    piece.x += piece.vx * 0.016;
    piece.y += piece.vy * 0.016;
    piece.vx *= 0.966;
    piece.vy *= 0.966;
    if (Math.hypot(piece.vx, piece.vy) < 0.075) {
      piece.vx = 0;
      piece.vy = 0;
    }
    if (Math.abs(piece.x) > limit) {
      piece.x = Math.sign(piece.x) * limit;
      piece.vx *= -0.76;
    }
    if (Math.abs(piece.y) > limit) {
      piece.y = Math.sign(piece.y) * limit;
      piece.vy *= -0.76;
    }
  }

  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i];
      const b = next[j];
      if (a.pocketed || b.pocketed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const gap = Math.hypot(dx, dy);
      const minGap = a.radius + b.radius;
      if (gap <= 0 || gap >= minGap) continue;
      const nx = dx / gap;
      const ny = dy / gap;
      const overlap = (minGap - gap) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      if (a.coin === "striker" && b.coin !== "striker") a.touchedCoin = true;
      if (b.coin === "striker" && a.coin !== "striker") b.touchedCoin = true;

      const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (relative > 0) continue;
      const impulse = relative * -0.95;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }

  for (const piece of next) {
    if (piece.pocketed) continue;
    const pocketed = carromPockets.some((pocket) => Math.hypot(piece.x - pocket.x, piece.y - pocket.y) < carromBoard.pocketRadius);
    if (!pocketed) continue;
    if (piece.coin === "striker") {
      piece.fouled = true;
      piece.x = 0;
      piece.y = carromBoard.strikerY;
      piece.vx = 0;
      piece.vy = 0;
    } else {
      piece.pocketed = true;
      piece.vx = 0;
      piece.vy = 0;
    }
  }

  return next;
}

function resolveCarromShot(
  before: CarromPiece[],
  after: CarromPiece[],
  owner: CarromPlayer,
  queen: QueenState,
  currentStrikerX: number
): ShotResult {
  const nextPieces = after.map((piece) => ({ ...piece }));
  const ownCoin = ownerCoin(owner);
  const otherCoin = ownerCoin(opponent(owner));
  const newlyPocketed = nextPieces.filter((piece) => piece.pocketed && !before.some((previous) => previous.id === piece.id && previous.pocketed));
  const ownPocketed = newlyPocketed.filter((piece) => piece.coin === ownCoin);
  const otherPocketed = newlyPocketed.filter((piece) => piece.coin === otherCoin);
  const queenPocketed = newlyPocketed.some((piece) => piece.coin === "queen");
  const strikerPocketed = nextPieces.some((piece) => piece.coin === "striker" && piece.fouled);
  const strikerTouchedAnyCoin = nextPieces.some((piece) => piece.coin === "striker" && piece.touchedCoin);
  const strikerTouchedOwnCoin = nextPieces.some((piece) => piece.coin === "striker" && piece.touchedCoinType === ownCoin);
  let nextQueen = { ...queen };
  let foul = strikerPocketed || !strikerTouchedOwnCoin || otherPocketed.length > 0;
  let message = "";

  for (const piece of newlyPocketed) {
    if (piece.coin === "white" || piece.coin === "black") piece.pocketedBy = piece.coin === playerCoin ? "player" : "ai";
    if (piece.coin === "queen") piece.pocketedBy = owner;
  }

  if (queen.status === "pending" && queen.holder === owner && !queenPocketed) {
    if (ownPocketed.length > 0 && !foul) {
      nextQueen = { status: "covered", holder: owner };
      message = `${owner === "player" ? "Queen covered. You continue." : "AI covered queen."}`;
    } else {
      const queenPiece = nextPieces.find((piece) => piece.coin === "queen");
      if (queenPiece) resetCoinNearCenter(queenPiece, nextPieces);
      nextQueen = { status: "available" };
      foul = true;
      message = `${owner === "player" ? "Queen not covered. Queen returns." : "AI failed to cover queen."}`;
    }
  }

  if (queenPocketed) {
    if (ownPocketed.length > 0 && !foul) {
      nextQueen = { status: "covered", holder: owner };
      message = `${owner === "player" ? "Queen pocketed and covered." : "AI pocketed and covered queen."}`;
    } else if (!foul) {
      nextQueen = { status: "pending", holder: owner };
      message = `${owner === "player" ? "Queen pocketed. Cover it with a white coin." : "AI pocketed queen and must cover."}`;
    }
  }

  if (foul) {
    applyPenalty(owner, nextPieces);
    if (queenPocketed || (queen.status === "pending" && queen.holder === owner)) {
      const queenPiece = nextPieces.find((piece) => piece.coin === "queen");
      if (queenPiece && queenPiece.pocketed) resetCoinNearCenter(queenPiece, nextPieces);
      nextQueen = { status: "available" };
    }
    message ||= strikerPocketed
      ? `${owner === "player" ? "Striker pocketed. Foul and AI turn." : "AI pocketed striker. Your turn."}`
      : !strikerTouchedAnyCoin
        ? `${owner === "player" ? "No coin touched. Foul and AI turn." : "AI missed every coin. Your turn."}`
        : !strikerTouchedOwnCoin
          ? `${owner === "player" ? "Striker hit the wrong coin first. Foul and AI turn." : "AI hit the wrong coin first. Your turn."}`
          : `${owner === "player" ? "Wrong coin pocketed. Foul and AI turn." : "AI pocketed your coin. Your turn."}`;
  }

  const ownerRemaining = nextPieces.filter((piece) => piece.coin === ownCoin && !piece.pocketed).length;
  if (ownerRemaining === 0 && nextQueen.status !== "covered") {
    applyPenalty(owner, nextPieces);
    foul = true;
    message = `${owner === "player" ? "You cannot finish before covering queen." : "AI cannot finish before covering queen."}`;
  }

  const playerRemaining = nextPieces.filter((piece) => piece.coin === playerCoin && !piece.pocketed).length;
  const aiRemaining = nextPieces.filter((piece) => piece.coin === aiCoin && !piece.pocketed).length;
  const winner = playerRemaining === 0 && nextQueen.status === "covered" && nextQueen.holder === "player"
    ? "player"
    : aiRemaining === 0 && nextQueen.status === "covered" && nextQueen.holder === "ai"
      ? "ai"
      : null;

  const earnedTurn = !foul && (ownPocketed.length > 0 || (queenPocketed && nextQueen.status === "pending"));
  const nextTurn = winner ? owner : earnedTurn ? owner : opponent(owner);
  if (!message) {
    message = earnedTurn
      ? `${owner === "player" ? "White coin pocketed. Shoot again." : "AI pocketed black and shoots again."}`
      : `${owner === "player" ? "Missed. AI turn." : "AI missed. Your turn."}`;
  }

  return {
    nextPieces: nextTurn === "ai"
      ? resetStrikerFor("ai", nextPieces, nextTurn === owner ? currentStrikerX : 0)
      : nextPieces,
    nextQueen,
    nextTurn,
    message,
    foul,
    playerFoul: owner === "player" && foul,
    playerMiss: owner === "player" && !foul && ownPocketed.length === 0 && !queenPocketed,
    winner
  };
}

function CarromGame({ assignment, onComplete }: GameProps) {
  const input = usePatientInput();
  const sessionEvents = useGameEvents();
  const finish = useCompletion(onComplete);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const processedEventRef = useRef("");
  const previousCarromGestureRef = useRef<GestureName>("open");
  const shotOwnerRef = useRef<CarromPlayer>("player");
  const movingRef = useRef(false);
  const motionFramesRef = useRef(0);
  const piecesRef = useRef<CarromPiece[]>([]);
  const [stage, setStage] = useState<CarromStage>("start");
  const [pieces, setPieces] = useState<CarromPiece[]>(() => createCarromPieces());
  const [turn, setTurn] = useState<CarromPlayer>("player");
  const [aim, setAim] = useState<CarromAim>({ angle: -Math.PI / 2, power: 0.58 });
  const [dragMode, setDragMode] = useState<CarromDragMode>(null);
  const [playerStrikerPlaced, setPlayerStrikerPlaced] = useState(false);
  const [playerStrikerLocked, setPlayerStrikerLocked] = useState(false);
  const [queen, setQueen] = useState<QueenState>({ status: "available" });
  const carromWorldRef = useRef<any | null>(null);
  const carromBodiesRef = useRef<Record<string, any>>({});
  const carromWorkingPiecesRef = useRef<CarromPiece[]>([]);
  const carromShotBeforePiecesRef = useRef<CarromPiece[] | null>(null);
  const carromQueenAtShotRef = useRef<QueenState>(queen);
  const carromStepsRef = useRef(0);
  const [shots, setShots] = useState(0);
  const [playerFouls, setPlayerFouls] = useState(0);
  const [aiFouls, setAiFouls] = useState(0);
  const [misses, setMisses] = useState(0);
  const [message, setMessage] = useState("Enter fullscreen to begin proper carrom.");
  const [winner, setWinner] = useState<CarromPlayer | null>(null);
  const lastAiShotSignatureRef = useRef<string | null>(null);
  const lastPlayerShotAtRef = useRef<number | null>(null);
  const aimSamplingRef = useRef<{
    active: boolean;
    startedAtMs: number;
    angles: number[];
    powers: number[];
  } | null>(null);
  const carromMetricAggRef = useRef<{
    shots: number;
    aimJitterSum: number;
    forceControlSum: number;
    timeToAimSumSec: number;
    restPauseSumSec: number;
  }>({ shots: 0, aimJitterSum: 0, forceControlSum: 0, timeToAimSumSec: 0, restPauseSumSec: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isMoving = piecesAreMoving(pieces);
  const pausedForFullscreen = stage === "playing" && !isFullscreen;
  const striker = pieces.find((piece) => piece.coin === "striker") ?? pieces[0];
  const playerPocketed = pieces.filter((piece) => piece.coin === playerCoin && piece.pocketed).length;
  const aiPocketed = pieces.filter((piece) => piece.coin === aiCoin && piece.pocketed).length;
  const playerRemaining = 9 - playerPocketed;
  const aiRemaining = 9 - aiPocketed;

  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  const boardPoint = useCallback((clientX: number, clientY: number, bounds: DOMRect) => ({
    x: ((clientX - bounds.left) / bounds.width - 0.5) * carromBoard.half * 2,
    y: ((clientY - bounds.top) / bounds.height - 0.5) * carromBoard.half * 2
  }), []);

  const aimFromPoint = useCallback((clientX: number, clientY: number, bounds: DOMRect): CarromAim => {
    const point = boardPoint(clientX, clientY, bounds);
    const dx = striker.x - point.x;
    const dy = striker.y - point.y;
    const length = Math.max(0.1, Math.hypot(dx, dy));
    return {
      angle: Math.atan2(dy, dx),
      power: clamp(length / 3.2, 0.2, 1)
    };
  }, [boardPoint, striker.x, striker.y]);

  const enterFullscreen = async () => {
    const board = boardRef.current;
    if (!board) return false;
    if (document.fullscreenElement === board) return true;
    try {
      await board.requestFullscreen();
      return true;
    } catch {
      setMessage("Browser blocked fullscreen. Use the fullscreen button to play.");
      return false;
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === boardRef.current) {
      await document.exitFullscreen();
      return;
    }
    await enterFullscreen();
  };

  const startGame = async () => {
    const fullscreenStarted = await enterFullscreen();
    const starter: CarromPlayer = Math.random() < 0.5 ? "player" : "ai";
    setPieces(resetStrikerFor(starter, createCarromPieces()));
    setTurn(starter);
    setPlayerStrikerPlaced(false);
    setPlayerStrikerLocked(starter === "player");
    setAim({ angle: starter === "player" ? -Math.PI / 2 : Math.PI / 2, power: 0.58 });
    setQueen({ status: "available" });
    setShots(0);
    setPlayerFouls(0);
    setAiFouls(0);
    setMisses(0);
    setWinner(null);
    lastAiShotSignatureRef.current = null;
    lastPlayerShotAtRef.current = null;
    aimSamplingRef.current = null;
    carromMetricAggRef.current = { shots: 0, aimJitterSum: 0, forceControlSum: 0, timeToAimSumSec: 0, restPauseSumSec: 0 };
    setMessage(fullscreenStarted
      ? starter === "player"
        ? "You won the break. Place striker on your baseline, then drag-release to shoot."
        : "AI won the break and will shoot from its baseline."
      : "Paused. Enter fullscreen to play.");
    shotOwnerRef.current = starter;
    movingRef.current = false;
    motionFramesRef.current = 0;
    setStage("playing");
  };

  const startCarromPhysicsShot = useCallback((owner: CarromPlayer, shotAim: CarromAim, basePiecesOverride?: CarromPiece[]) => {
    const pl = planck as any;

    const basePieces = basePiecesOverride ?? piecesRef.current;
    const beforePieces = basePieces.map((p) => ({ ...p }));

    const strikerVx = Math.cos(shotAim.angle) * carromBoard.maxPower * shotAim.power;
    const strikerVy = Math.sin(shotAim.angle) * carromBoard.maxPower * shotAim.power;

    // Working pieces are mutated by the physics contact handler.
    const workingPieces = beforePieces.map((piece) => {
      if (piece.coin !== "striker") return { ...piece, vx: 0, vy: 0 };
      return {
        ...piece,
        vx: strikerVx,
        vy: strikerVy,
        fouled: false,
        touchedCoin: false,
        touchedCoinType: undefined
      };
    });

    carromShotBeforePiecesRef.current = beforePieces;
    carromWorkingPiecesRef.current = workingPieces;
    carromQueenAtShotRef.current = queen;
    carromStepsRef.current = 0;
    shotOwnerRef.current = owner;

    // Clear any previous world.
    carromWorldRef.current = null;
    carromBodiesRef.current = {};

    // Physics world (top-down: no gravity).
    const world: any = new pl.World(pl.Vec2(0, 0));
    const bodiesById: Record<string, any> = {};
    const pieceIndexById: Record<string, number> = {};
    const bodyToPiece: Map<any, { pieceId: string; coin: CarromCoin }> = new Map();
    workingPieces.forEach((p, idx) => { pieceIndexById[p.id] = idx; });

    // Board bounds: use the playable inner square, not the full visual model.
    const half = carromBoard.playHalf;
    const boundaryBody = world.createBody();
    boundaryBody.createFixture(pl.Edge(pl.Vec2(-half, -half), pl.Vec2(half, -half)));
    boundaryBody.createFixture(pl.Edge(pl.Vec2(-half, half), pl.Vec2(half, half)));
    boundaryBody.createFixture(pl.Edge(pl.Vec2(-half, -half), pl.Vec2(-half, half)));
    boundaryBody.createFixture(pl.Edge(pl.Vec2(half, -half), pl.Vec2(half, half)));

    // Pocket sensors at the 4 corners.
    const pocketRadius = carromBoard.pocketRadius * 1.06;
    for (const pocket of carromPockets) {
      const pocketBody = world.createBody({ position: pl.Vec2(pocket.x, pocket.y) });
      pocketBody.createFixture(pl.Circle(pocketRadius), { isSensor: true });
    }

    const linearDamping = 1.1;
    const fixtureFriction = 0.012;
    const fixtureRestitution = 0.965;

    // Coins + striker.
    for (const piece of workingPieces) {
      if (piece.pocketed) continue;
      const body = world.createDynamicBody({ position: pl.Vec2(piece.x, piece.y) });
      body.setLinearDamping(linearDamping);
      const fixture = body.createFixture(pl.Circle(piece.radius), {
        density: 1,
        friction: fixtureFriction,
        restitution: fixtureRestitution
      });
      body.setLinearVelocity(pl.Vec2(piece.vx, piece.vy));
      bodiesById[piece.id] = body;
      bodyToPiece.set(body, { pieceId: piece.id, coin: piece.coin });
    }

    // Contact handling: pocket detection + striker-touch detection.
    world.on("begin-contact", (contact: any) => {
      const fixA = contact.getFixtureA();
      const fixB = contact.getFixtureB();
      const isSensorA = typeof fixA.isSensor === "function" ? fixA.isSensor() : false;
      const isSensorB = typeof fixB.isSensor === "function" ? fixB.isSensor() : false;
      const bodyA = typeof fixA.getBody === "function" ? fixA.getBody() : null;
      const bodyB = typeof fixB.getBody === "function" ? fixB.getBody() : null;
      const pieceA = bodyA ? bodyToPiece.get(bodyA) ?? null : null;
      const pieceB = bodyB ? bodyToPiece.get(bodyB) ?? null : null;

      // If either fixture is a pocket sensor, the other fixture is a piece.
      if (isSensorA && pieceB) {
        const idx = pieceIndexById[pieceB.pieceId];
        const piece = workingPieces[idx];
        if (!piece || piece.pocketed || piece.fouled) return;
        if (piece.coin === "striker") {
          piece.fouled = true;
          piece.x = 0;
          piece.y = owner === "player" ? carromBoard.strikerY : carromBoard.aiStrikerY;
          piece.touchedCoinType = undefined;
        } else {
          piece.pocketed = true;
        }
        piece.vx = 0;
        piece.vy = 0;
        const body = bodiesById[pieceB.pieceId];
        if (body) {
          world.destroyBody(body);
          delete bodiesById[pieceB.pieceId];
          bodyToPiece.delete(body);
        }
        return;
      }
      if (isSensorB && pieceA) {
        const idx = pieceIndexById[pieceA.pieceId];
        const piece = workingPieces[idx];
        if (!piece || piece.pocketed || piece.fouled) return;
        if (piece.coin === "striker") {
          piece.fouled = true;
          piece.x = 0;
          piece.y = owner === "player" ? carromBoard.strikerY : carromBoard.aiStrikerY;
          piece.touchedCoinType = undefined;
        } else {
          piece.pocketed = true;
        }
        piece.vx = 0;
        piece.vy = 0;
        const body = bodiesById[pieceA.pieceId];
        if (body) {
          world.destroyBody(body);
          delete bodiesById[pieceA.pieceId];
          bodyToPiece.delete(body);
        }
        return;
      }

      // Normal collision: if striker touches any non-striker coin, mark it.
      if (pieceA && pieceB) {
        if (pieceA.coin === "striker" && pieceB.coin !== "striker") {
          const strikerPiece = workingPieces[pieceIndexById[pieceA.pieceId]];
          strikerPiece.touchedCoin = true;
          // Preserve the first-contact coin type for more accurate foul rules.
          strikerPiece.touchedCoinType ??= pieceB.coin;
        }
        if (pieceB.coin === "striker" && pieceA.coin !== "striker") {
          const strikerPiece = workingPieces[pieceIndexById[pieceB.pieceId]];
          strikerPiece.touchedCoin = true;
          strikerPiece.touchedCoinType ??= pieceA.coin;
        }
      }
    });

    carromWorldRef.current = world;
    carromBodiesRef.current = bodiesById;

    // Immediately push the initial velocities into React state for responsive UI gating.
    setPieces(workingPieces);
  }, [queen]);

  const shoot = useCallback((owner: CarromPlayer, shotAim: CarromAim) => {
    if (stage !== "playing" || movingRef.current || (owner === "player" && !isFullscreen)) return;
    movingRef.current = true;
    motionFramesRef.current = 0;
    setShots((value) => value + (owner === "player" ? 1 : 0));
    if (owner === "player") lastPlayerShotAtRef.current = performance.now();
    if (owner === "player") {
      setPlayerStrikerPlaced(false);
      setPlayerStrikerLocked(false);
    }
    startCarromPhysicsShot(owner, shotAim);
    setMessage(owner === "player" ? "Shot moving." : "AI shot moving.");
  }, [isFullscreen, stage, startCarromPhysicsShot]);

  const updateAimFromPoint = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    const nextAim = aimFromPoint(clientX, clientY, bounds);
    setAim(nextAim);

    if (aimSamplingRef.current?.active) {
      aimSamplingRef.current.angles.push(nextAim.angle);
      aimSamplingRef.current.powers.push(nextAim.power);
    }
    input.setHandPosition({
      x: ((clientX - bounds.left) / bounds.width) * 100,
      y: ((clientY - bounds.top) / bounds.height) * 100,
      z: 0
    });
    return nextAim;
  }, [aimFromPoint, input]);

  const placePlayerStriker = (clientX: number, clientY: number, bounds: DOMRect) => {
    const point = boardPoint(clientX, clientY, bounds);
    const shouldLock = playerStrikerLocked || Math.abs(point.y - carromBoard.strikerY) <= carromBoard.baselineSnapDistance;
    const x = shouldLock
      ? clamp(point.x, carromBoard.baselineMinX, carromBoard.baselineMaxX)
      : clamp(point.x, -carromBoard.playHalf + carromBoard.strikerRadius, carromBoard.playHalf - carromBoard.strikerRadius);
    const y = shouldLock
      ? carromBoard.strikerY
      : clamp(point.y, -carromBoard.playHalf + carromBoard.strikerRadius, carromBoard.playHalf - carromBoard.strikerRadius);

    if (shouldLock && !playerStrikerLocked) {
      setPlayerStrikerLocked(true);
      setMessage("Striker locked to baseline. Slide left or right, then release to place.");
    }

    setPieces((current) => current.map((piece) => piece.coin === "striker"
      ? {
          ...piece,
          x,
          y,
          vx: 0,
          vy: 0,
          pocketed: false,
          fouled: false,
          touchedCoin: false,
          touchedCoinType: undefined
        }
      : piece));
    return shouldLock;
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === boardRef.current;
      setIsFullscreen(active);
      if (!active && stage === "playing") setMessage("Paused. Re-enter fullscreen to continue.");
      if (active && stage === "playing") setMessage(turn === "player" ? "Your turn. Place striker or drag-release to shoot." : "AI turn.");
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [stage, turn]);

  useEffect(() => {
    if (stage !== "playing" || pausedForFullscreen) return;
    const timer = window.setInterval(() => {
      const world = carromWorldRef.current;
      if (!world) return;

      const wasMoving = movingRef.current;
      carromStepsRef.current += 1;

      // Keep the simulation roughly in sync with the 16ms tick.
      // (We still use Planck's fixed step for stable collisions.)
      world.step(1 / 60);

      const workingPieces = carromWorkingPiecesRef.current;
      const bodiesById = carromBodiesRef.current;

      // Copy physics state back into working pieces.
      for (const piece of workingPieces) {
        if (piece.pocketed) continue;
        const body = bodiesById[piece.id];
        if (!body) continue;
        const pos = body.getPosition();
        const vel = body.getLinearVelocity();
        const clampedX = clamp(pos.x, -carromBoard.playHalf + piece.radius, carromBoard.playHalf - piece.radius);
        const clampedY = clamp(pos.y, -carromBoard.playHalf + piece.radius, carromBoard.playHalf - piece.radius);
        if (clampedX !== pos.x || clampedY !== pos.y) {
          body.setTransform((planck as any).Vec2(clampedX, clampedY), body.getAngle());
          body.setLinearVelocity((planck as any).Vec2(vel.x * -0.25, vel.y * -0.25));
        }
        piece.x = clampedX;
        piece.y = clampedY;
        piece.vx = vel.x;
        piece.vy = vel.y;
      }

      const nowMoving = Object.keys(bodiesById).some((id) => {
        const body = bodiesById[id];
        if (!body) return false;
        const vel = body.getLinearVelocity();
        return Math.hypot(vel.x, vel.y) > 0.035;
      });

      movingRef.current = nowMoving;

      const hardStop = carromStepsRef.current > 5200;
      const shouldResolve = (wasMoving && !nowMoving) || hardStop;
      if (shouldResolve) {
        const owner = shotOwnerRef.current;
        const before = carromShotBeforePiecesRef.current;
        const after = carromWorkingPiecesRef.current;
        const queenAtShot = carromQueenAtShotRef.current;
        const strikerAfter = after.find((p) => p.coin === "striker");

        if (before) {
          const result = resolveCarromShot(before, after, owner, queenAtShot, strikerAfter ? strikerAfter.x : 0);
          setQueen(result.nextQueen);
          setTurn(result.nextTurn);
          setMessage(result.message);
          if (result.playerFoul) setPlayerFouls((value) => value + 1);
          if (owner === "ai" && result.foul) setAiFouls((value) => value + 1);
          if (result.playerMiss) setMisses((value) => value + 1);
          if (result.nextTurn === "player") {
            setPlayerStrikerPlaced(false);
            setPlayerStrikerLocked(false);
          }
          if (result.winner) {
            setWinner(result.winner);
            window.setTimeout(() => setStage("ended"), 250);
          }

          // Apply resolved board state and stop stepping this world.
          setPieces(result.nextPieces);
        }

        carromWorldRef.current = null;
        carromBodiesRef.current = {};
        carromWorkingPiecesRef.current = [];
        carromShotBeforePiecesRef.current = null;
        movingRef.current = false;
        return;
      }

      // Continue animation.
      setPieces([...workingPieces]);
    }, 16);
    return () => window.clearInterval(timer);
  }, [pausedForFullscreen, stage]);

  useEffect(() => {
    const event = input.events[0];
    if (
      stage !== "playing"
      || turn !== "player"
      || isMoving
      || pausedForFullscreen
      || !event
      || processedEventRef.current === event.id
      || event.gesture !== "flick"
      || !playerStrikerPlaced
    ) return;
    processedEventRef.current = event.id;
    shoot("player", aim);
  }, [aim, input.events, isMoving, pausedForFullscreen, shoot, stage, turn]);

  useEffect(() => {
    const previous = previousCarromGestureRef.current;
    const current = input.currentGesture;
    previousCarromGestureRef.current = current;
    if (
      stage !== "playing"
      || turn !== "player"
      || isMoving
      || pausedForFullscreen
      || !playerStrikerPlaced
      || previous !== "fist"
      || current !== "open"
    ) return;
    shoot("player", aim);
  }, [aim, input.currentGesture, isMoving, pausedForFullscreen, playerStrikerPlaced, shoot, stage, turn]);

  useEffect(() => {
    if (stage !== "playing" || turn !== "ai") return;
    if (piecesAreMoving(pieces)) return;
    setMessage("AI lining up shot.");
    const timer = window.setTimeout(() => {
      let aiChoice = chooseAiShot(pieces, queen, assignment.config.difficulty);
      // Re-roll if we accidentally repeat the last move signature.
      const attempts = 4;
      for (let attempt = 1; aiChoice && lastAiShotSignatureRef.current && attempt < attempts; attempt += 1) {
        if (aiChoice.signature !== lastAiShotSignatureRef.current) break;
        aiChoice = chooseAiShot(pieces, queen, assignment.config.difficulty);
      }

      if (!aiChoice) {
        setMessage("AI has no legal target. Your turn.");
        setTurn("player");
        setPlayerStrikerPlaced(false);
        setPlayerStrikerLocked(false);
        return;
      }
      lastAiShotSignatureRef.current = aiChoice.signature;
      const aiPieces = resetStrikerFor("ai", pieces, aiChoice.strikerX);
      const aiAim = aiChoice.aim;
      movingRef.current = true;
      setAim(aiAim);
      setMessage("AI shot moving.");
      startCarromPhysicsShot("ai", aiAim, aiPieces);
    }, 950);
  }, [assignment.config.difficulty, pieces, queen, stage, startCarromPhysicsShot, striker, turn]);

  const carromMetrics = carromMetricAggRef.current;

  const saveResult = () => {
    const metricShots = Math.max(carromMetrics.shots, 1);
    finish({
      repsCompleted: shots,
      successfulReps: playerPocketed,
      failedAttempts: misses + playerFouls,
      accuracy: carromAccuracy(playerPocketed, misses, playerFouls),
      bestStreak: playerPocketed,
      weakestFinger: sessionEvents.length ? weakestFingerFromEvents(sessionEvents) : undefined,
      events: sessionEvents,
      gameMetrics: {
        playerPocketed,
        aiPocketed,
        playerFouls,
        aiFouls,
        misses,
        winner,
        averageAimJitterDeg: Number(((carromMetrics.aimJitterSum / metricShots) * 180 / Math.PI).toFixed(2)),
        averagePullConsistency: Math.round((carromMetrics.forceControlSum / metricShots) * 100),
        averageTimeToAimSec: Number((carromMetrics.timeToAimSumSec / metricShots).toFixed(2)),
        averageRestPauseSec: Number((carromMetrics.restPauseSumSec / metricShots).toFixed(2))
      }
    });
  };

  const canInteract = stage === "playing" && turn === "player" && !isMoving && !pausedForFullscreen;
  const canAim = canInteract && playerStrikerPlaced;
  const queenLabel = queen.status === "available" ? "On board" : queen.status === "pending" ? `${queen.holder === "player" ? "You" : "AI"} cover` : `${queen.holder === "player" ? "You" : "AI"} covered`;

  return (
    <div
      ref={boardRef}
      className="carrom-3d-board"
      onPointerDown={(event) => {
        if (!canInteract) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!playerStrikerPlaced) {
          setDragMode("place");
          placePlayerStriker(event.clientX, event.clientY, bounds);
        } else {
          setDragMode("aim");
          aimSamplingRef.current = {
            active: true,
            startedAtMs: performance.now(),
            angles: [],
            powers: []
          };
          updateAimFromPoint(event.clientX, event.clientY, bounds);
        }
      }}
      onPointerMove={(event) => {
        if (!canInteract || !dragMode) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (dragMode === "place") {
          placePlayerStriker(event.clientX, event.clientY, bounds);
        } else {
          updateAimFromPoint(event.clientX, event.clientY, bounds);
        }
      }}
      onPointerUp={(event) => {
        if (!canInteract || !dragMode) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        if (dragMode === "aim") {
          const nextAim = updateAimFromPoint(event.clientX, event.clientY, bounds);

          // Aggregate rehab metrics for this aim/release cycle (approximate).
          const sampling = aimSamplingRef.current;
          if (sampling?.active) {
            const nowMs = performance.now();
            const timeToAimSec = (nowMs - sampling.startedAtMs) / 1000;
            const angleArr = sampling.angles;
            const powerArr = sampling.powers;

            const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1);
            const stdDev = (arr: number[]) => {
              if (arr.length < 2) return 0;
              const m = mean(arr);
              const variance = arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length;
              return Math.sqrt(variance);
            };

            const angleStd = stdDev(angleArr);
            const powerMean = mean(powerArr);
            const powerStd = stdDev(powerArr);
            // Higher is better: stable pull distance / force control.
            const pullConsistency = clamp(1 - powerStd / Math.max(powerMean, 1e-6), 0, 1);

            const restPauseSec = lastPlayerShotAtRef.current === null
              ? 0
              : (nowMs - lastPlayerShotAtRef.current) / 1000;

            carromMetricAggRef.current.shots += 1;
            carromMetricAggRef.current.aimJitterSum += angleStd;
            carromMetricAggRef.current.forceControlSum += pullConsistency;
            carromMetricAggRef.current.timeToAimSumSec += timeToAimSec;
            carromMetricAggRef.current.restPauseSumSec += restPauseSec;

            aimSamplingRef.current = null;
          }

          input.emitGesture("flick", gestureTargets.flick, input.handPosition);
        } else {
          const locked = placePlayerStriker(event.clientX, event.clientY, bounds);
          if (locked) {
            setPlayerStrikerPlaced(true);
            setPlayerStrikerLocked(true);
            setMessage("Striker placed. Pull back anywhere on the board and release to shoot.");
          } else {
            setMessage("Drag the striker onto the yellow baseline until it snaps in.");
          }
        }
        setDragMode(null);
      }}
      onPointerCancel={() => {
        aimSamplingRef.current = null;
        setDragMode(null);
      }}
      onPointerLeave={() => {
        aimSamplingRef.current = null;
        setDragMode(null);
      }}
    >
        <Canvas
          orthographic
          camera={{ position: [0, 8, 0], zoom: 118, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        shadows
      >
        <CameraLookAt target={[0, 0, 0]} />
        <ambientLight intensity={0.78} />
        <directionalLight position={[2, 6, 4]} intensity={1.05} />
        <CarromScene
          pieces={pieces}
          aim={aim}
          showAim={canAim && dragMode === "aim"}
          placementGuideMode={canInteract && !playerStrikerPlaced ? (playerStrikerLocked ? "locked" : "recover") : null}
        />
      </Canvas>

      <div className="carrom-hud">
        <div>
          <span className="eyebrow">Carrom</span>
          <strong>{turn === "player" ? "Your Turn" : "AI Turn"}</strong>
        </div>
        <div className="carrom-stat-row">
          <span>You {playerPocketed}/9 White</span>
          <span>AI {aiPocketed}/9 Black</span>
          <span>Queen {queenLabel}</span>
          <span>Power {Math.round(aim.power * 100)}%</span>
          <span>Fouls {playerFouls}-{aiFouls}</span>
        </div>
      </div>

      <div className="carrom-status-bar">
        <span>{message}</span>
        <span>{canInteract ? (playerStrikerPlaced ? "Aim: pull back and release." : "Place striker on your baseline first.") : pausedForFullscreen ? "Fullscreen required." : isMoving ? "Pieces moving." : "Waiting."}</span>
      </div>

      {stage === "start" && (
        <div className="carrom-overlay">
          <div className="carrom-menu">
            <span className="eyebrow">Full Carrom</span>
            <h3>Carrom</h3>
            <p>Real setup: nine white, nine black, queen cover rule, fouls, striker baseline placement, and AI opponent. Fullscreen is required to play.</p>
            <div className="carrom-menu-actions">
              <button type="button" className="primary-button" onClick={startGame}>Start Fullscreen Game</button>
              <button type="button" className="secondary-button" onClick={toggleFullscreen}>
                {isFullscreen ? "Exit Fullscreen" : "Go Fullscreen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pausedForFullscreen && (
        <div className="carrom-overlay">
          <div className="carrom-menu">
            <span className="eyebrow">Paused</span>
            <h3>Fullscreen Required</h3>
            <p>Game pauses when fullscreen exits. Re-enter fullscreen to continue.</p>
            <button type="button" className="primary-button" onClick={toggleFullscreen}>Resume Fullscreen</button>
          </div>
        </div>
      )}

      {stage === "ended" && (
        <div className="carrom-overlay">
          <div className="carrom-menu">
            <span className="eyebrow">Game Over</span>
            <h3>{winner === "player" ? "You Win" : "AI Wins"}</h3>
            <p>You pocketed {playerPocketed} white coins with {playerFouls} fouls and {misses} misses. Queen: {queenLabel}.</p>
            {carromMetrics.shots > 0 && (
              <p>
                Avg Aim Jitter: {((carromMetrics.aimJitterSum / carromMetrics.shots) * 180 / Math.PI).toFixed(1)}° · Avg Pull Consistency: {(carromMetrics.forceControlSum / carromMetrics.shots * 100).toFixed(0)}% · Avg Time to Aim: {(carromMetrics.timeToAimSumSec / carromMetrics.shots).toFixed(1)}s · Avg Rest Pause: {(carromMetrics.restPauseSumSec / carromMetrics.shots).toFixed(1)}s
              </p>
            )}
            <div className="carrom-menu-actions">
              <button type="button" className="primary-button" onClick={saveResult}>Save Results</button>
              <button type="button" className="secondary-button" onClick={startGame}>Play Again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CameraLookAt({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, -1);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  }, [camera, target]);
  return null;
}

function CarromScene({
  pieces,
  aim,
  showAim,
  placementGuideMode
}: {
  pieces: CarromPiece[];
  aim: CarromAim;
  showAim: boolean;
  placementGuideMode: "recover" | "locked" | null;
}) {
  const striker = pieces.find((piece) => piece.coin === "striker") ?? pieces[0];

  return (
    <group>
      <CarromBoardModel />
      <CarromBoardGuides mode={placementGuideMode} />
      {pieces.filter((piece) => !piece.pocketed).map((piece) => (
        <CarromPieceMesh key={piece.id} piece={piece} />
      ))}
      {showAim && (
        <CarromAimGuide striker={striker} aim={aim} />
      )}
    </group>
  );
}

function CarromBoardGuides({ mode }: { mode: "recover" | "locked" | null }) {
  // Visual guide only: keep striker movement bounds separate from this length.
  const guideMinX = -1.72;
  const guideMaxX = 1.72;
  const baselineLength = guideMaxX - guideMinX;
  const baselineCenterX = (guideMinX + guideMaxX) / 2;
  const guideY = 0.39;
  const railColor = mode === "locked" ? "#22c55e" : "#facc15";
  const railEmissive = mode === "locked" ? "#16a34a" : "#eab308";

  if (!mode) return null;

  return (
    <group position={[baselineCenterX, guideY, carromBoard.strikerY]}>
      <mesh>
        <boxGeometry args={[baselineLength, 0.028, 0.022]} />
        <meshStandardMaterial
          color={railColor}
          emissive={railEmissive}
          emissiveIntensity={0.18}
          roughness={0.6}
        />
      </mesh>
    </group>
  );
}

function carromPiecePalette(coin: CarromCoin) {
  if (coin === "white") {
    return {
      side: "#d9b17d",
      top: "#fff1cf",
      ring: "#8b6b42",
      center: "#f7dca9"
    };
  }
  if (coin === "black") {
    return {
      side: "#111111",
      top: "#262626",
      ring: "#696969",
      center: "#171717"
    };
  }
  if (coin === "queen") {
    return {
      side: "#a5163a",
      top: "#e83f70",
      ring: "#ffd1dd",
      center: "#f7a1ba"
    };
  }
  return {
    side: "#0f4ab8",
    top: "#1663e6",
    ring: "#9cc7ff",
    center: "#0b3e9d"
  };
}

function CarromPieceMesh({ piece }: { piece: CarromPiece }) {
  const palette = carromPiecePalette(piece.coin);
  const height = piece.coin === "striker" ? 0.16 : 0.12;
  const topY = 0.32 + height / 2 + 0.004;
  const ringY = topY + 0.004;
  const centerY = ringY + 0.004;
  const ringThickness = piece.coin === "striker" ? 0.012 : 0.009;

  return (
    <group position={[piece.x, 0.32, piece.y]}>
      <mesh>
        <cylinderGeometry args={[piece.radius, piece.radius, height, 72]} />
        <meshStandardMaterial color={palette.side} roughness={0.68} metalness={0.04} />
      </mesh>
      <mesh position={[0, height / 2 + 0.003, 0]}>
        <cylinderGeometry args={[piece.radius * 0.92, piece.radius * 0.92, 0.014, 72]} />
        <meshStandardMaterial color={palette.top} roughness={0.55} metalness={0.02} />
      </mesh>
      <mesh position={[0, ringY - 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[piece.radius * 0.55, ringThickness, 12, 72]} />
        <meshStandardMaterial color={palette.ring} roughness={0.48} metalness={0.03} />
      </mesh>
      <mesh position={[0, centerY - 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[piece.radius * 0.24, ringThickness * 0.82, 10, 48]} />
        <meshStandardMaterial color={palette.ring} roughness={0.48} metalness={0.03} />
      </mesh>
      <mesh position={[0, centerY - 0.318, 0]}>
        <cylinderGeometry args={[piece.radius * 0.12, piece.radius * 0.12, 0.012, 32]} />
        <meshStandardMaterial color={palette.center} roughness={0.48} metalness={0.03} />
      </mesh>
    </group>
  );
}

function CarromBoardModel() {
  const { scene } = useGLTF(carromBoardModelUrl);
  const board = useMemo(() => scene.clone(true), [scene]);
  const [transform, setTransform] = useState<{ position: [number, number, number]; scale: [number, number, number] }>(() => ({
    position: [0, 0.19, 0],
    scale: [1.45, 1.45, 1.45]
  }));

  useEffect(() => {
    // The optimized GLB is small enough to render without aggressive mesh hiding.
    // Rendering all meshes avoids cases where the "top 2 by area" heuristic
    // accidentally hides the board surface after re-export/optimization.
    const meshes: Mesh[] = [];
    board.traverse((child) => {
      if (child instanceof Mesh) {
        meshes.push(child);
        child.visible = true;
        child.castShadow = false;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const candidate = material as Record<string, unknown>;
          if ("side" in candidate) candidate.side = DoubleSide;
          if ("needsUpdate" in candidate) candidate.needsUpdate = true;
        }
      }
    });

    // Auto-orient the board so its thinnest axis becomes world Y.
    // Different GLB exports use different up-axes, so we detect the flattest dimension
    // and rotate the whole model onto the game's X/Z plane.
    const rawBbox = new Box3();
    for (const mesh of meshes) {
      const tmp = new Box3().setFromObject(mesh);
      rawBbox.union(tmp);
    }
    const rawSize = new Vector3();
    rawBbox.getSize(rawSize);
    const axisSizes = [
      { axis: "x" as const, size: rawSize.x },
      { axis: "y" as const, size: rawSize.y },
      { axis: "z" as const, size: rawSize.z }
    ].sort((a, b) => a.size - b.size);
    const thinnestAxis = axisSizes[0]?.axis ?? "y";

    const rotation: [number, number, number] =
      thinnestAxis === "z"
        ? [-Math.PI / 2, 0, 0]
        : thinnestAxis === "x"
          ? [0, 0, Math.PI / 2]
          : [0, 0, 0];

    board.rotation.set(rotation[0], rotation[1], rotation[2]);
    board.updateMatrixWorld(true);

    // Calibrate model placement to the game’s coordinate system.
    // Use a uniform scale so we preserve the board proportions.
    const targetSize = carromBoard.half * 2;
    const bbox = new Box3();

    for (const mesh of meshes) {
      const tmp = new Box3().setFromObject(mesh);
      bbox.union(tmp);
    }

    const size = new Vector3();
    bbox.getSize(size);
    const center = new Vector3();
    bbox.getCenter(center);

    if (size.x > 0.0001 && size.z > 0.0001) {
      const uniformScale = targetSize / Math.max(size.x, size.z);

      // Striker/coins are rendered around y=0.32. Keep the board top slightly
      // below that plane so pieces are always visible above the board.
      const worldBoardTopY = 0.18;
      const posX = -center.x * uniformScale;
      const posZ = -center.z * uniformScale;
      const posY = worldBoardTopY - bbox.max.y * uniformScale;

      setTransform({
        position: [posX, posY, posZ],
        scale: [uniformScale, uniformScale, uniformScale]
      });
    }
  }, [board]);

  return (
    <group position={transform.position} scale={transform.scale}>
      <primitive object={board} />
    </group>
  );
}

useGLTF.preload(carromBoardModelUrl);

function CarromAimGuide({ striker, aim }: { striker: CarromPiece; aim: CarromAim }) {
  const dx = Math.cos(aim.angle);
  const dz = Math.sin(aim.angle);
  const rotationY = Math.PI / 2 - aim.angle;
  const greenLength = 0.9;
  const redLength = 0.35 + aim.power * 1.75;
  const greenStart = striker.radius + 0.08;
  const redStart = striker.radius + 0.05;

  return (
    <group>
      <mesh
        position={[
          striker.x + dx * (greenStart + greenLength / 2),
          0.48,
          striker.y + dz * (greenStart + greenLength / 2)
        ]}
        rotation={[0, rotationY, 0]}
      >
        <boxGeometry args={[0.065, 0.055, greenLength]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.2} />
      </mesh>
      <mesh
        position={[
          striker.x + dx * (greenStart + greenLength + 0.14),
          0.48,
          striker.y + dz * (greenStart + greenLength + 0.14)
        ]}
        rotation={[Math.PI / 2, 0, -rotationY]}
      >
        <coneGeometry args={[0.14, 0.28, 24]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.2} />
      </mesh>
      <mesh
        position={[
          striker.x - dx * (redStart + redLength / 2),
          0.47,
          striker.y - dz * (redStart + redLength / 2)
        ]}
        rotation={[0, rotationY, 0]}
      >
        <boxGeometry args={[0.052, 0.05, redLength]} />
        <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.18} />
      </mesh>
    </group>
  );
}

function CarromLines() {
  return (
    <group position={[0, 0.24, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.018, 12, 72]} />
        <meshStandardMaterial color="#7c2d12" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.012, 12, 64]} />
        <meshStandardMaterial color="#7c2d12" />
      </mesh>
      {[-2.35, 2.35].map((y) => (
        <group key={y} position={[0, 0, y]}>
          <mesh>
            <boxGeometry args={[4.25, 0.022, 0.03]} />
            <meshStandardMaterial color="#7c2d12" />
          </mesh>
          {[-2.12, 2.12].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.14, 0.012, 10, 32]} />
              <meshStandardMaterial color="#7c2d12" />
            </mesh>
          ))}
        </group>
      ))}
      {[-2.35, 2.35].map((x) => (
        <group key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <boxGeometry args={[4.25, 0.022, 0.03]} />
            <meshStandardMaterial color="#7c2d12" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export const gameIcons: Record<GameId, typeof CircleDot> = {
  "ball-pickup": CircleDot,
  "finger-tap-piano": Music2,
  "bubble-pop": Sparkles,
  "carrom-flick": CheckCircle2
};
