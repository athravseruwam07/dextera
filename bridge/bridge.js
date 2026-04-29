/**
 * Gloving Serial Bridge
 *
 * Reads JSON lines from an ESP32 glove over USB serial and forwards
 * each frame to the backend via POST /api/glove/event.
 *
 * ESP32 must print one JSON object per line at 115200 baud:
 *   {"thumb":820,"index":910,"middle":880,"ring":760,"pinky":700,"gesture":"fist"}
 *
 * Finger values from ESP32 can be raw ADC (0–4095) or already 0–100.
 * If a calibration exists on the backend for PATIENT_ID the bridge fetches
 * it on startup and normalises raw values to 0–100 before posting.
 *
 * Usage:
 *   cp .env.example .env   # fill in SERIAL_PORT and PATIENT_ID
 *   npm install
 *   node bridge.js
 */

require("dotenv").config();

const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const SERIAL_PORT = process.env.SERIAL_PORT;
const BACKEND_URL = (process.env.BACKEND_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const PATIENT_ID = process.env.PATIENT_ID || "demo-patient-1";
const BAUD_RATE = Number(process.env.BAUD_RATE || 115200);
const RETRY_DELAY_MS = 3000;
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

if (!SERIAL_PORT) {
  console.error("[bridge] ERROR: SERIAL_PORT env var is required.");
  console.error("[bridge] Example: SERIAL_PORT=/dev/tty.usbserial-0001 node bridge.js");
  process.exit(1);
}

// Calibration loaded on startup and refreshed periodically.
// Shape: { open: { thumb, index, middle, ring, pinky }, closed: { ... } }
let calibration = null;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a raw ADC reading to 0–100 using calibration open/closed values.
 * open  → 0% (finger straight)
 * closed → 100% (finger fully bent)
 */
function normalize(rawValue, finger) {
  if (!calibration) {
    // No calibration — scale 12-bit ADC (0-4095) to 0-100
    return clamp(Math.round((rawValue / 4095) * 100));
  }
  const openVal = calibration.open?.[finger] ?? 0;
  const closedVal = calibration.closed?.[finger] ?? 4095;
  const range = closedVal - openVal;
  if (range === 0) return 0;
  return clamp(Math.round(((rawValue - openVal) / range) * 100));
}

async function fetchCalibration() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/calibration/${PATIENT_ID}`);
    if (response.ok) {
      calibration = await response.json();
      console.log("[bridge] Calibration loaded for patient:", PATIENT_ID);
    } else {
      console.log("[bridge] No calibration found — raw values treated as 0–100.");
    }
  } catch {
    console.log("[bridge] Could not reach backend for calibration — raw values treated as 0–100.");
  }
}

async function postGloveEvent(payload) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/glove/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[bridge] Backend rejected event:", response.status, text);
    }
  } catch (err) {
    console.error("[bridge] Failed to POST event:", err.message);
  }
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // JSON format: {"thumb":820,"index":910,...}
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // CSV format: thumb,index,middle,ring,pinky
  const parts = trimmed.split(",");
  if (parts.length === 5) {
    const nums = parts.map(Number);
    if (nums.every((n) => !isNaN(n))) {
      return { thumb: nums[0], index: nums[1], middle: nums[2], ring: nums[3], pinky: nums[4] };
    }
  }

  return null;
}

let activePort = null;

function connect() {
  console.log(`[bridge] Connecting to ${SERIAL_PORT} at ${BAUD_RATE} baud…`);

  const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE, autoOpen: false });
  activePort = port;

  port.open((err) => {
    if (err) {
      console.error("[bridge] Could not open serial port:", err.message);
      console.log(`[bridge] Retrying in ${RETRY_DELAY_MS / 1000}s…`);
      setTimeout(connect, RETRY_DELAY_MS);
      return;
    }
    console.log("[bridge] Serial port open. Forwarding glove data to", BACKEND_URL);
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  parser.on("data", async (line) => {
    const frame = parseLine(line);
    if (!frame) {
      console.log(`[bridge] unparsed line: ${JSON.stringify(line)}`);
      return;
    }

    const payload = {
      patientId: PATIENT_ID,
      gesture: frame.gesture || "unknown",
      thumb: normalize(frame.thumb ?? 0, "thumb"),
      index: normalize(frame.index ?? 0, "index"),
      middle: normalize(frame.middle ?? 0, "middle"),
      ring: normalize(frame.ring ?? 0, "ring"),
      pinky: normalize(frame.pinky ?? 0, "pinky"),
      rawValues: {
        thumb: frame.thumb ?? 0,
        index: frame.index ?? 0,
        middle: frame.middle ?? 0,
        ring: frame.ring ?? 0,
        pinky: frame.pinky ?? 0
      },
      timestamp: new Date().toISOString()
    };

    const rawDisplay  = FINGERS.map((f) => `${f[0].toUpperCase()}:${frame[f] ?? "?"}`).join(" ");
    const normDisplay = FINGERS.map((f) => `${f[0].toUpperCase()}:${payload[f]}`).join(" ");
    console.log(`[bridge] raw(${rawDisplay})  norm(${normDisplay})  gesture:${payload.gesture}`);

    await postGloveEvent(payload);
  });

  port.on("error", (err) => {
    console.error("\n[bridge] Serial error:", err.message);
    setTimeout(connect, RETRY_DELAY_MS);
  });

  port.on("close", () => {
    console.log("\n[bridge] Serial port closed. Reconnecting…");
    setTimeout(connect, RETRY_DELAY_MS);
  });
}

async function main() {
  console.log("[bridge] Gloving Serial Bridge starting…");
  console.log(`[bridge] Patient: ${PATIENT_ID}  Backend: ${BACKEND_URL}  Port: ${SERIAL_PORT}`);

  await fetchCalibration();
  connect();
  setInterval(fetchCalibration, 30000);
}

process.on("SIGINT", () => {
  console.log("\n[bridge] Shutting down…");
  if (activePort?.isOpen) activePort.close();
  process.exit(0);
});

main();
