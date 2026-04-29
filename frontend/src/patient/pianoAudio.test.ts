import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPianoMuted, pianoFingerFrequencies, playPianoSound, storePianoMuted } from "./pianoAudio";

describe("Finger Tap Piano audio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps fingers to ascending piano notes", () => {
    expect(pianoFingerFrequencies.thumb).toBeLessThan(pianoFingerFrequencies.index);
    expect(pianoFingerFrequencies.index).toBeLessThan(pianoFingerFrequencies.middle);
    expect(pianoFingerFrequencies.middle).toBeLessThan(pianoFingerFrequencies.ring);
    expect(pianoFingerFrequencies.ring).toBeLessThan(pianoFingerFrequencies.pinky);
  });

  it("persists mute state", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      }
    });
    storePianoMuted(true);
    expect(loadPianoMuted()).toBe(true);
    storePianoMuted(false);
    expect(loadPianoMuted()).toBe(false);
  });

  it("suppresses playback when muted", () => {
    expect(playPianoSound("index", "correct", true)).toBe(false);
  });
});
