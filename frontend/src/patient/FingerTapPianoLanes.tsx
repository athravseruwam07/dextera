import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { fingerNames } from "../lib/gesture";
import type { FingerName, GestureEvent, GestureName, PatientCareAssignment } from "../types";
import { emitFingerTap, usePatientInput } from "./input";
import type { GamePlayResult, PatientGameSharedProps as GameProps } from "./gameTypes";
import { usePatientGameFullscreenControls } from "./patientGameFullscreenContext";
import { loadPianoMuted, playPianoSound, storePianoMuted, unlockPianoAudio } from "./pianoAudio";

export type FingerTapLanesPreset = {
  requiredHits: number;
  maxMisses: number;
  initialSpeed: number;
  speedStepHits: number;
  speedBump: number;
  maxSpeed: number;
  timeLimitSeconds: number | null;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fingerTapLanesPreset(assignment: PatientCareAssignment, accessibilityMode: boolean): FingerTapLanesPreset {
  const { targetReps } = assignment.config;
  const extra = accessibilityMode ? 2 : 0;
  const requiredHits = clamp(
    Math.round(14 + Math.floor(Math.max(targetReps, 4) / 2) + extra),
    14,
    26
  );
  const maxMisses = clamp(Math.ceil(requiredHits * 0.45) + (accessibilityMode ? 2 : 0), 9, 16);
  return {
    requiredHits,
    maxMisses,
    initialSpeed: accessibilityMode ? 0.146 : 0.168,
    speedStepHits: 3,
    speedBump: 1.055,
    maxSpeed: 0.36,
    timeLimitSeconds: 180
  };
}

const LANE_LABEL: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

const LANE_KEY_BADGE: Record<FingerName, string> = {
  thumb: "C",
  index: "D",
  middle: "E",
  ring: "F",
  pinky: "G"
};

const KEYCODE_TO_FINGER: Partial<Record<string, FingerName>> = {
  KeyC: "thumb",
  KeyD: "index",
  KeyE: "middle",
  KeyF: "ring",
  KeyG: "pinky",
  Digit1: "thumb",
  Digit2: "index",
  Digit3: "middle",
  Digit4: "ring",
  Digit5: "pinky"
};

type LanePhase = "idle" | "playing" | "complete";

type FallingTile = {
  id: string;
  lane: FingerName;
  y: number;
  h: number;
  /** True once the tile has overlapped the scoring band (slip miss only if this was true). */
  enteredBand: boolean;
};

/**
 * Must match `.piano-lanes-hitstrip__beam` in styles (`bottom: 10%`, `height: 21%` vs `.piano-key-lane__rail`).
 * Normalized from top of the rail.
 */
const HIT_TOP = 0.69;
const HIT_BOTTOM = 0.9;

/** Lose tile only after it has clearly cleared the playable band (fraction of lane track height). */
const MISS_PAST_BOTTOM = 1.18;

function tileOverlapsHitZone(tile: FallingTile): boolean {
  const bot = tile.y + tile.h;
  return bot > HIT_TOP && tile.y < HIT_BOTTOM;
}

function fingerFromTapGesture(gesture: GestureName): FingerName | null {
  if (!gesture.startsWith("tap_")) return null;
  const rest = gesture.slice(4);
  return fingerNames.includes(rest as FingerName) ? (rest as FingerName) : null;
}

function emptyMisses(): Record<FingerName, number> {
  return fingerNames.reduce(
    (acc, f) => {
      acc[f] = 0;
      return acc;
    },
    {} as Record<FingerName, number>
  );
}

function useSessionEventsSinceMount() {
  const { events } = usePatientInput();
  const startedAtRef = useRef(Date.now());
  return useMemo(
    () => events.filter((event) => new Date(event.timestamp).getTime() >= startedAtRef.current),
    [events]
  );
}

export function FingerTapPianoLanesGame({ assignment, accessibilityMode, onComplete }: GameProps) {
  const fullscreen = usePatientGameFullscreenControls();
  const input = usePatientInput();
  const gloveControlsActive = input.rawConnected;
  const sessionEvents = useSessionEventsSinceMount();
  const preset = useMemo(
    () => fingerTapLanesPreset(assignment, accessibilityMode),
    [assignment, accessibilityMode]
  );

  const tileH = accessibilityMode ? 0.098 : 0.086;

  const [phase, setPhase] = useState<LanePhase>("idle");
  const [paused, setPaused] = useState(false);
  const [tiles, setTiles] = useState<FallingTile[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [missByFinger, setMissByFinger] = useState(emptyMisses);
  const [timedOut, setTimedOut] = useState(false);
  const [lostByMisses, setLostByMisses] = useState(false);
  const [flash, setFlash] = useState<{ finger: FingerName; kind: "ok" | "bad" } | null>(null);
  const [streakPulse, setStreakPulse] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => loadPianoMuted());

  const speedRef = useRef(preset.initialSpeed);
  const tilesRef = useRef<FallingTile[]>([]);
  const phaseRef = useRef<LanePhase>("idle");
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(performance.now());
  const spawnAccRef = useRef(0);
  const laneHistRef = useRef<FingerName[]>([]);
  const hitsRef = useRef(0);

  const gameStartedAtRef = useRef<number | null>(null);
  const resultSentRef = useRef(false);
  const [resultCommitted, setResultCommitted] = useState(false);
  const processedEventRef = useRef("");
  /** Dedupe stray double-fires when both pointer events and click-ish noise occur on tap surfaces */
  const lastEmittedByFingerRef = useRef<Partial<Record<FingerName, number>>>({});

  const flashTimerRef = useRef<number | undefined>();

  phaseRef.current = phase;
  pausedRef.current = paused;
  hitsRef.current = hits;

  /** Tiles: `tilesRef` is authoritative for physics; `tiles` state is only pushed via setTiles from RAF / applyResolution. */

  const scheduleFlash = useCallback((finger: FingerName, kind: "ok" | "bad") => {
    window.clearTimeout(flashTimerRef.current);
    setFlash({ finger, kind });
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 380);
  }, []);

  useEffect(
    () => () => window.clearTimeout(flashTimerRef.current),
    []
  );

  const speedForHits = useCallback(
    (n: number) =>
      Math.min(
        preset.initialSpeed * Math.pow(preset.speedBump, Math.floor(n / preset.speedStepHits)),
        preset.maxSpeed
      ),
    [preset.initialSpeed, preset.maxSpeed, preset.speedBump, preset.speedStepHits]
  );

  const pickLane = useCallback((): FingerName => {
    let choice = fingerNames[Math.floor(Math.random() * fingerNames.length)]!;
    for (let i = 0; i < 10; i += 1) {
      const cand = fingerNames[Math.floor(Math.random() * fingerNames.length)]!;
      const last = laneHistRef.current.slice(-2);
      if (!(last.length === 2 && last[0] === cand && last[1] === cand)) {
        choice = cand;
        break;
      }
    }
    laneHistRef.current = [...laneHistRef.current.slice(-15), choice];
    return choice;
  }, []);

  const finalizeToParent = useCallback(() => {
    if (resultSentRef.current) return;
    resultSentRef.current = true;
    setResultCommitted(true);
    const acc = clampPercent((hits / Math.max(hits + misses, 1)) * 100);
    const weakest =
      misses > 0
        ? ([...fingerNames].sort((a, b) => missByFinger[b] - missByFinger[a])[0] as FingerName)
        : undefined;
    const start = gameStartedAtRef.current ?? Date.now();
    const payload: GamePlayResult = {
      repsCompleted: hits,
      successfulReps: hits,
      failedAttempts: misses,
      accuracy: acc,
      timeTakenSeconds: Math.max(1, Math.round((Date.now() - start) / 1000)),
      bestStreak,
      weakestFinger: weakest,
      events: sessionEvents,
      gameMetrics: {
        hits,
        misses,
        bestStreak,
        missByFinger,
        timedOut,
        lostByMisses,
        inputSource: gloveControlsActive ? "glove" : "demo"
      }
    };
    onComplete(payload);
  }, [bestStreak, gloveControlsActive, hits, lostByMisses, missByFinger, misses, onComplete, sessionEvents, timedOut]);

  useEffect(() => {
    if (phase !== "playing") return;
    if (hits >= preset.requiredHits) {
      setPhase("complete");
      return;
    }
    if (preset.timeLimitSeconds != null && elapsedSeconds >= preset.timeLimitSeconds && hits < preset.requiredHits) {
      setTimedOut(true);
      setPhase("complete");
      return;
    }
    if (misses >= preset.maxMisses) {
      setLostByMisses(true);
      setPhase("complete");
    }
  }, [elapsedSeconds, hits, misses, phase, preset.maxMisses, preset.requiredHits, preset.timeLimitSeconds]);

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((value) => {
      const next = !value;
      storePianoMuted(next);
      return next;
    });
  }, []);

  const beginRound = useCallback(() => {
    void unlockPianoAudio();
    resultSentRef.current = false;
    setResultCommitted(false);
    lastEmittedByFingerRef.current = {};
    gameStartedAtRef.current = Date.now();
    setPhase("playing");
    setPaused(false);
    setElapsedSeconds(0);
    setTiles([]);
    tilesRef.current = [];
    setHits(0);
    setMisses(0);
    setStreak(0);
    setBestStreak(0);
    setMissByFinger(emptyMisses());
    setTimedOut(false);
    setLostByMisses(false);
    processedEventRef.current = "";
    laneHistRef.current = [];
    speedRef.current = preset.initialSpeed;
    spawnAccRef.current = 900;
    lastFrameRef.current = performance.now();
  }, [preset.initialSpeed]);

  const restartToIdle = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPhase("idle");
    setPaused(false);
    gameStartedAtRef.current = null;
    setElapsedSeconds(0);
    setTiles([]);
    tilesRef.current = [];
    resultSentRef.current = false;
    setResultCommitted(false);
    lastEmittedByFingerRef.current = {};
    setHits(0);
    setMisses(0);
    setStreak(0);
    setBestStreak(0);
    setMissByFinger(emptyMisses());
    setTimedOut(false);
    setLostByMisses(false);
    speedRef.current = preset.initialSpeed;
  }, [preset.initialSpeed]);

  const applyResolution = useCallback(
    (finger: FingerName) => {
      if (phaseRef.current !== "playing" || pausedRef.current) return;
      const current = tilesRef.current;
      const inLane = current.filter((t) => t.lane === finger && tileOverlapsHitZone(t));
      if (inLane.length) {
        const best = inLane.reduce((a, b) => (a.y > b.y ? a : b));
        const next = current.filter((t) => t.id !== best.id);
        tilesRef.current = next;
        setTiles(next);
        setHits((h) => {
          const nh = h + 1;
          hitsRef.current = nh;
          speedRef.current = speedForHits(nh);
          setStreak((s) => {
            const ns = s + 1;
            setBestStreak((b) => Math.max(b, ns));
            if (ns >= 3 && ns % 3 === 0) {
              setStreakPulse(true);
              window.setTimeout(() => setStreakPulse(false), 420);
            }
            return ns;
          });
          return nh;
        });
        scheduleFlash(finger, "ok");
        playPianoSound(finger, "correct", soundMuted);
        return;
      }
      /** Wrong lane during an active beat in another lane, or sloppy tap timing. */
      const otherLaneActive = current.some((t) => tileOverlapsHitZone(t) && t.lane !== finger);
      if (otherLaneActive) {
        setMisses((m) => m + 1);
        setStreak(0);
        setMissByFinger((prev) => ({ ...prev, [finger]: prev[finger] + 1 }));
        scheduleFlash(finger, "bad");
        playPianoSound(finger, "wrong", soundMuted);
      }
    },
    [scheduleFlash, soundMuted, speedForHits]
  );

  useEffect(() => {
    if (phase !== "playing" || paused) return;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.055, Math.max(0, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;

      let next = tilesRef.current.map((t) => {
        const y = t.y + speedRef.current * dt;
        const nt = { ...t, y };
        const enteredBand = t.enteredBand || tileOverlapsHitZone(nt);
        return { ...nt, enteredBand };
      });

      const missed: FingerName[] = [];
      next = next.filter((t) => {
        if (t.y > MISS_PAST_BOTTOM) {
          if (t.enteredBand) missed.push(t.lane);
          return false;
        }
        return true;
      });

      if (missed.length) {
        setMisses((m) => m + missed.length);
        setStreak(0);
        setMissByFinger((prev) => {
          const copy = { ...prev };
          for (const lane of missed) copy[lane] += 1;
          return copy;
        });
        if (missed[0]) {
          scheduleFlash(missed[0], "bad");
          playPianoSound(missed[0], "miss", soundMuted);
        }
      }

      spawnAccRef.current += dt * 1000;
      const gap = clamp(1080 - hitsRef.current * 16 - (speedRef.current - preset.initialSpeed) * 1100, 520, 1180);
      while (spawnAccRef.current >= gap) {
        spawnAccRef.current -= gap * 0.96;
        const lane = pickLane();
        next.push({
          id: `tile-${now}-${Math.random().toString(36).slice(2, 9)}`,
          lane,
          y: -tileH * 1.7,
          h: tileH,
          enteredBand: false
        });
      }

      tilesRef.current = next;
      setTiles(next);

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [paused, phase, pickLane, preset.initialSpeed, scheduleFlash, soundMuted, tileH]);

  useEffect(() => {
    if (phase !== "playing" || paused) return;
    const id = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [paused, phase]);

  /**
   * Screen/keyboard taps: scored synchronously in emitLaneTap (never via this queue).
   * This drains (a) local patient-input spam from the glove demo ticker and (b) remote tap_* glove events.
   */
  useEffect(() => {
    if (phase !== "playing" || paused) return;
    const LOCAL = "patient-input-";

    let guard = 0;
    while (guard < 260) {
      guard += 1;
      let tapEvent: GestureEvent | undefined;
      for (let i = input.events.length - 1; i >= 0; i -= 1) {
        const e = input.events[i];
        if (!e?.gesture.startsWith("tap_") || e.id === processedEventRef.current) continue;
        tapEvent = e;
        break;
      }
      if (!tapEvent) return;

      if (tapEvent.id.startsWith(LOCAL)) {
        /** Local emits are scored in emitLaneTap; demo interval tap_* spam is peeled off here without scoring. */
        processedEventRef.current = tapEvent.id;
        continue;
      }

      processedEventRef.current = tapEvent.id;
      const finger = fingerFromTapGesture(tapEvent.gesture as GestureName);
      if (!finger) return;

      applyResolution(finger);
      return;
    }
  }, [applyResolution, input.events, paused, phase]);

  const emitLaneTap = useCallback(
    (finger: FingerName) => {
      if (phaseRef.current !== "playing" || pausedRef.current) return;
      if (gloveControlsActive) return;
      const now = performance.now();
      const prev = lastEmittedByFingerRef.current[finger];
      if (prev != null && now - prev < 72) return;
      lastEmittedByFingerRef.current[finger] = now;
      emitFingerTap(finger, input.emitGesture);
      applyResolution(finger);
    },
    [applyResolution, gloveControlsActive, input.emitGesture]
  );

  const onLaneTapPointer = useCallback(
    (finger: FingerName, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      emitLaneTap(finger);
    },
    [emitLaneTap]
  );

  useEffect(() => {
    if (phase !== "playing" || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const finger = KEYCODE_TO_FINGER[e.code];
      if (!finger) return;
      e.preventDefault();
      emitLaneTap(finger);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emitLaneTap, paused, phase]);

  const accuracy =
    phase === "idle" ? null : clampPercent((hits / Math.max(hits + misses, 1)) * 100);

  const progressPercent = phase === "idle" ? 0 : clamp((hits / Math.max(preset.requiredHits, 1)) * 100, 0, 100);

  const subtitle =
    preset.timeLimitSeconds != null ? (
      <>
        Goal <strong>{preset.requiredHits}</strong> taps · Hard · max <strong>{preset.maxMisses}</strong> misses ·{" "}
        <strong>{preset.timeLimitSeconds}s</strong> cap
      </>
    ) : (
      <>
        Goal <strong>{preset.requiredHits}</strong> taps · Hard
      </>
    );

  const statusLine =
    phase === "idle"
      ? "Press Start, then tap the matching column when a note reaches the target band."
      : paused
        ? "Paused — notes resume when you continue."
        : `${hits}/${preset.requiredHits} hits · misses ${misses}/${preset.maxMisses}${streak > 1 ? ` · streak ${streak}` : ""}`;

  return (
    <section className="finger-tap-piano-root piano-lanes-root piano-tiles-mode" aria-label="Finger Tap Piano lanes session">
      <header className="piano-hero piano-hero--lanes piano-tile-hud">
        <div className="piano-hero__row piano-hero__row--lanes">
          <div className="piano-hero__brand">
            <h2 className="piano-hero__title">Finger Tap Piano</h2>
            <p className="piano-hero__summary">
              <span className="piano-hero__summary-strong">{subtitle}</span>
              <span className="piano-hero__dot" aria-hidden>
                ·
              </span>
          <span>{gloveControlsActive ? "Falling notes · tap with the glove" : "Falling notes · tap the matching key column"}</span>
            </p>
          </div>
          <div className="piano-hero__trailing">
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
                    Start round
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button piano-btn piano-btn--ghost"
                      onClick={() => setPaused((p) => !p)}
                      aria-pressed={paused}
                    >
                      {paused ? "Resume" : "Pause"}
                    </button>
                    <button type="button" className="secondary-button piano-btn piano-btn--ghost" onClick={() => restartToIdle()}>
                      Restart
                    </button>
                  </>
                )}
              </div>
            )}
            {fullscreen?.isSupported ? (
              <div className="piano-hero-fs-inline">
                {!fullscreen.isFullscreen ? (
                  <button
                    type="button"
                    className="secondary-button patient-game-fs-btn piano-hero-fs-btn"
                    onClick={() => void fullscreen.enterFullscreen()}
                    aria-label="Enter fullscreen"
                  >
                    <Maximize2 size={15} strokeWidth={2} aria-hidden />
                    Fullscreen
                  </button>
                ) : (
                  <>
                    <button
                      ref={fullscreen.exitButtonRef}
                      type="button"
                      className="secondary-button patient-game-fs-btn piano-hero-fs-btn"
                      onClick={() => void fullscreen.exitFullscreen()}
                      aria-label="Exit fullscreen"
                      aria-describedby="piano-lanes-fs-esc-hint"
                    >
                      <Minimize2 size={15} strokeWidth={2} aria-hidden />
                      Exit fullscreen
                    </button>
                    <span className="patient-game-fs-hint piano-hero-fs-esc-hint" id="piano-lanes-fs-esc-hint">
                      Esc
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {phase !== "complete" ? (
          <>
            <div
              className="piano-hero-progress piano-hero-progress--compact"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
            >
              <div className="piano-hero-progress__rail">
                <div className="piano-hero-progress__fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="piano-hero-progress__caption">
                {phase === "idle" ? (
                  <>Reach {preset.requiredHits} taps in the target band</>
                ) : (
                  <>
                    Progress <strong>{hits}</strong> / <strong>{preset.requiredHits}</strong>
                  </>
                )}
              </div>
            </div>
            <div className="piano-metrics piano-metrics--lanes" aria-live="polite" role={phase === "idle" ? undefined : "status"}>
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Hits</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : `${hits}/${preset.requiredHits}`}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Acc</span>
                <span className="piano-metrics__value">{accuracy !== null ? `${accuracy}%` : "—"}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Miss</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : `${misses}/${preset.maxMisses}`}</span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Run</span>
                <span className={`piano-metrics__value${streakPulse ? " piano-streak-pulse" : ""}`}>
                  {phase === "idle" ? "—" : streak}
                </span>
              </div>
              <span className="piano-metrics__sep" aria-hidden />
              <div className="piano-metrics__item">
                <span className="piano-metrics__label">Best</span>
                <span className="piano-metrics__value">{phase === "idle" ? "—" : bestStreak}</span>
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
                    <span className="piano-metrics__label">Left</span>
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
                {hits}/{preset.requiredHits}
              </span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Accuracy</span>
              <span className="piano-metrics__value">{clampPercent((hits / Math.max(hits + misses, 1)) * 100)}%</span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Misses</span>
              <span className="piano-metrics__value">{misses}</span>
            </div>
            <span className="piano-metrics__sep" aria-hidden />
            <div className="piano-metrics__item">
              <span className="piano-metrics__label">Best streak</span>
              <span className="piano-metrics__value">{bestStreak}</span>
            </div>
          </div>
        )}
      </header>

      <div className={`piano-playfield piano-playfield--lanes${phase === "complete" ? " piano-playfield--complete" : ""}`}>
        <p className={`piano-tile-hintbar${phase === "idle" ? "" : " piano-tile-hintbar--dim"}`} role="note">
          <strong>How to play:</strong>{" "}
          {gloveControlsActive ? (
            <>Tap the matching finger when the black tile reaches the cyan strike band. </>
          ) : (
            <>
              Tap the key when the black tile reaches the cyan strike band. Keys <kbd className="piano-kbd-mini">C</kbd>
              –<kbd className="piano-kbd-mini">G</kbd>.{" "}
            </>
          )}
          {phase === "idle" ? "Press Start." : null}
        </p>

        <div className={`piano-lanes-board ${phase === "idle" ? "piano-lanes-board--idle" : ""}`} aria-busy={paused || phase !== "playing"}>
          {phase === "playing" && (
            <div className="piano-lanes-board-head piano-tile-board-meta">
              <span className={`piano-status-pill${paused ? " piano-status-pill--paused" : ""}`}>{paused ? "Paused" : "Live"}</span>
              <p className="piano-status-line">{statusLine}</p>
            </div>
          )}

          <div
            className={`piano-tile-keydesk${flash?.kind === "ok" ? " piano-tile-keydesk--pulse-ok" : ""}${flash?.kind === "bad" ? " piano-tile-keydesk--pulse-miss" : ""}`}
          >
            {phase === "playing" && (
              <p className="piano-tile-strike-hint" aria-live="polite">
                Strike when the tile crosses the <strong>glowing band</strong> at the bottom of the keys.
              </p>
            )}

            <div className="piano-tile-keyboard-face">
              <div className="piano-tile-keys-grid" role="group" aria-label="Five white piano keys; strike when a tile reaches the band">
                {fingerNames.map((finger) => (
                  <button
                    key={finger}
                    type="button"
                    className={`piano-tile-key piano-key-lane ${flash?.finger === finger ? (flash.kind === "ok" ? "piano-key-lane--hit" : "piano-key-lane--miss") : ""}`}
                    disabled={phase !== "playing" || paused || gloveControlsActive}
                    aria-label={`${LANE_LABEL[finger]} column — tap when a note aligns with target band`}
                    onPointerDown={(e) => onLaneTapPointer(finger, e)}
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <div className="piano-key-lane__rail">
                      {tiles
                        .filter((t) => t.lane === finger)
                        .map((t) => {
                          const inBand = tileOverlapsHitZone(t);
                          return (
                            <div
                              key={t.id}
                              className={`piano-note-tile${inBand ? " piano-note-tile--in-band" : ""}`}
                              style={{ top: `${t.y * 100}%`, height: `${t.h * 100}%` }}
                            />
                          );
                        })}
                    </div>
                    <div className="piano-tile-key-front" aria-hidden="true">
                      <span className="piano-tile-key-front__note">{LANE_KEY_BADGE[finger]}</span>
                      <span className="piano-tile-key-front__finger">{LANE_LABEL[finger]}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {paused && phase === "playing" && <div className="piano-board-overlay piano-board-overlay--pause">Paused</div>}
        </div>

        {phase === "complete" && (
          <div className="piano-complete-wrap">
            <section className="piano-complete-card" aria-labelledby="lanes-summary-title">
              <div className="piano-complete-card__banner">
                <h3 id="lanes-summary-title">
                  {timedOut ? "Time Limit Reached" : lostByMisses ? "Round Ended · Miss Limit" : "Round Complete"}
                </h3>
                <p>
                  {timedOut
                    ? `${hits}/${preset.requiredHits} taps before the session timer ended.`
                    : lostByMisses
                      ? `${hits} taps · misses reached (${misses}).`
                      : `${hits} correct taps · best streak ${bestStreak}. Continue when ready.`}
                </p>
              </div>
              <div className="piano-complete-card__footer">
                <button type="button" className="primary-button piano-btn piano-btn--primary" onClick={finalizeToParent} disabled={resultCommitted}>
                  Continue to Check-In
                </button>
                <button type="button" className="secondary-button piano-btn piano-btn--ghost" onClick={restartToIdle}>
                  Back to Intro
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      <span className="piano-live-region" aria-live="polite">
        {statusLine}
      </span>
    </section>
  );
}
