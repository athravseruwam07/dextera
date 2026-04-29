import type { FingerName } from "../types";

export type PianoSoundKind = "correct" | "wrong" | "miss";

const muteStorageKey = "gloving.patient.pianoMuted.v1";

export const pianoFingerFrequencies: Record<FingerName, number> = {
  thumb: 261.63,
  index: 293.66,
  middle: 329.63,
  ring: 349.23,
  pinky: 392
};

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  return audioContext;
}

export function loadPianoMuted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(muteStorageKey) === "true";
}

export function storePianoMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(muteStorageKey, muted ? "true" : "false");
}

export async function unlockPianoAudio() {
  const context = getAudioContext();
  if (!context || context.state !== "suspended") return;
  await context.resume();
}

export function playPianoSound(finger: FingerName, kind: PianoSoundKind, muted: boolean) {
  if (muted) return false;
  const context = getAudioContext();
  if (!context) return false;

  const now = context.currentTime;
  const output = context.createGain();
  output.connect(context.destination);

  const oscillator = context.createOscillator();
  const tone = context.createGain();
  oscillator.type = kind === "miss" ? "triangle" : "sine";
  oscillator.frequency.setValueAtTime(kind === "miss" ? 130.81 : pianoFingerFrequencies[finger], now);
  tone.gain.setValueAtTime(0.0001, now);
  tone.gain.exponentialRampToValueAtTime(kind === "correct" ? 0.18 : 0.09, now + 0.012);
  tone.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "correct" ? 0.28 : 0.16));
  oscillator.connect(tone);
  tone.connect(output);
  oscillator.start(now);
  oscillator.stop(now + (kind === "correct" ? 0.32 : 0.2));

  if (kind === "wrong") {
    const thud = context.createOscillator();
    const thudGain = context.createGain();
    thud.type = "triangle";
    thud.frequency.setValueAtTime(98, now);
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    thud.connect(thudGain);
    thudGain.connect(output);
    thud.start(now);
    thud.stop(now + 0.16);
  }

  return true;
}
