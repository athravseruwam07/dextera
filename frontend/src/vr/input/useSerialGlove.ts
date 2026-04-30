import { useCallback, useRef, useState } from "react";
import { useGameStore } from "../state/gameStore";
import type { VrGestureName } from "../types/gesture";

// Minimal Web Serial API surface — not yet in TypeScript's lib
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialAPI {
  requestPort(): Promise<SerialPort>;
}

// Tune these to match your ESP32 ADC range (0–1023 typical)
const OPEN_THRESHOLD = 300;
const CLOSED_THRESHOLD = 700;
const PINCH_THRESHOLD = 600;
const BAUD_RATE = 115200;

function classifyGesture(values: number[]): VrGestureName {
  const [thumb, index, middle, ring] = values;
  if (values.every((v) => v < OPEN_THRESHOLD)) return "open";
  if (values.every((v) => v > CLOSED_THRESHOLD)) return "fist";
  if (
    thumb > PINCH_THRESHOLD &&
    index > PINCH_THRESHOLD &&
    middle < OPEN_THRESHOLD &&
    ring < OPEN_THRESHOLD
  )
    return "pinch";
  return "unknown";
}

function normalize(v: number): number {
  return Math.min(100, Math.round((v / 1023) * 100));
}

export function useSerialGlove() {
  const setGestureEvent = useGameStore((s) => s.setGestureEvent);
  const patientId = useGameStore((s) => s.patientId);

  const [isConnected, setIsConnected] = useState(false);
  const [gesture, setGesture] = useState<string>("—");

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const readLoop = useCallback(
    async (port: SerialPort): Promise<void> => {
      const decoder = new TextDecoder();
      let buffer = "";
      const reader = port.readable!.getReader();
      readerRef.current = reader;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const parts = line.trim().split(",").map(Number);
            if (parts.length !== 5 || parts.some(isNaN)) continue;

            const [thumb, index, middle, ring, pinky] = parts;
            const g = classifyGesture(parts);
            setGesture(g);
            setGestureEvent({
              patientId,
              gesture: g,
              thumb: normalize(thumb),
              index: normalize(index),
              middle: normalize(middle),
              ring: normalize(ring),
              pinky: normalize(pinky),
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch {
        // port closed or cancelled — fall through
      } finally {
        setIsConnected(false);
        setGesture("—");
      }
    },
    [patientId, setGestureEvent]
  );

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) {
      alert("Web Serial API not supported. Use Chrome or Edge.");
      return;
    }
    try {
      const serial = (navigator as Navigator & { serial?: SerialAPI }).serial;
      const port = await serial!.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      portRef.current = port;
      setIsConnected(true);
      readLoop(port);
    } catch (err) {
      console.error("Serial connect failed:", err);
    }
  }, [readLoop]);

  const disconnect = useCallback(async () => {
    readerRef.current?.cancel();
    try {
      await portRef.current?.close();
    } catch {
      // already closed
    }
    portRef.current = null;
    readerRef.current = null;
    setIsConnected(false);
    setGesture("—");
  }, []);

  return { isConnected, gesture, connect, disconnect };
}
