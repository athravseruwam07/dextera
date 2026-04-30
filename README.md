# Dextera

Dextera is a smart-glove rehabilitation platform for people rebuilding hand mobility after stroke, neurological injury, or hand and wrist trauma. It turns therapy into measurable, game-based recovery: a sensorized glove streams finger motion from an ESP32 into a real-time clinical dashboard, while patients complete guided rehab games that measure reps, accuracy, pain, fatigue, and progress over time.

The goal is simple: make home hand therapy more engaging for patients and more observable for clinicians.

![dextera glove](docs/glove-photo.jpg)

## What Dextera Does

- Captures live finger bend data from a five-sensor rehab glove.
- Normalizes raw ESP32 ADC readings into calibrated 0-100 finger bend percentages.
- Classifies clinically useful gestures such as open hand, fist, point, pinch, taps, and flicks.
- Streams live glove events to a doctor dashboard over WebSockets.
- Lets clinicians assign rehab games and finger exercises to patients.
- Gives patients a guided portal with calibration, tutorials, check-ins, game play, results, and progress.
- Tracks recovery signals such as reps, accuracy, weakest finger, adherence, pain, fatigue, and difficulty recommendations.
- Combines real glove hardware, camera tracking, and clinician-facing analytics into one connected rehab workflow.

## Who It Is For

Dextera is designed for people rebuilding hand mobility, coordination, and confidence after neurological or orthopedic injury. It is especially relevant for:

- Stroke survivors working on hand opening, grip release, finger isolation, and fine motor control.
- Patients recovering from hand, wrist, or forearm injury who need structured repetition outside the clinic.
- People with reduced dexterity, stiffness, weakness, or impaired coordination who benefit from guided practice.
- Therapists and rehabilitation teams who need better visibility into home exercise adherence and movement quality.

Dextera does not replace a clinician. It gives patients a more engaging way to practice and gives care teams richer data for follow-up decisions.

## System Overview

```text
Flex sensors on glove
        |
ESP32 reads raw ADC values
        | USB serial
Node serial bridge normalizes and forwards frames
        | HTTP POST
Backend API stores events and broadcasts updates
        | WebSocket + REST
Doctor dashboard + patient rehab games
```

The project is organized into four main parts:

| Part | Path | Purpose |
| --- | --- | --- |
| Glove firmware | `esp32/` | Reads five flex sensors and prints JSON frames over serial. |
| Serial bridge | `bridge/` | Reads ESP32 serial data, applies calibration, and posts glove events to the backend. |
| Backend | `backend/` | Express API, WebSocket stream, storage, assignments, sessions, calibration, AI helpers. |
| Frontend | `frontend/` | Doctor dashboard, patient portal, calibration UI, analytics, and rehab games. |

## Smart Glove Hardware

The glove is a lightweight sensor layer built around five flex sensors and an ESP32. Each finger has an independent analog channel, so Dextera can measure not just "open" or "closed" gestures, but which fingers are moving, how far, and how consistently.

### Glove Components

| Component | Role |
| --- | --- |
| ESP32 development board | Main microcontroller. Reads sensor voltages and sends JSON frames over USB serial. |
| Five flex sensors | One sensor per finger: thumb, index, middle, ring, and pinky. Bending a finger changes resistance. |
| 10k ohm resistors | Each flex sensor is paired with a resistor as a voltage divider for analog measurement. |
| Wiring harness | Routes each sensor signal back to the ESP32 analog pins. |
| USB connection | Powers the ESP32 and carries serial data to the laptop bridge. |
| Calibration software | Captures each patient's open/fist baselines and converts raw ADC values into meaningful bend percentages. |

### ESP32 Pin Map

The current firmware reads these analog inputs:

| Finger | ESP32 Pin | ADC Channel |
| --- | --- | --- |
| Thumb | GPIO 34 | ADC1_CH6 |
| Index | GPIO 35 | ADC1_CH7 |
| Middle | GPIO 32 | ADC1_CH4 |
| Ring | GPIO 33 | ADC1_CH5 |
| Pinky | GPIO 36 | VP / ADC1_CH0 |

Each sensor produces a raw 12-bit ADC value from `0` to `4095`. The ESP32 intentionally sends raw readings only; gesture classification happens later using per-patient calibration.

Example serial frame:

```json
{"thumb":820,"index":910,"middle":880,"ring":760,"pinky":700}
```

### Calibration

Calibration makes the glove patient-specific:

1. The patient holds an open hand.
2. Dextera captures raw open baselines for each finger.
3. The patient makes a fist.
4. Dextera captures raw closed baselines.
5. The bridge and frontend map future readings into `0-100` bend values, where `0` is straight and `100` is fully bent.

Some games collect extra calibration:

- Finger Tap Piano captures per-finger tap baselines.
- Bubble Pop captures point and pinch shapes.
- Carrom captures three index/middle finger flicks and converts extension speed into shot power.

## Product Experience

### Doctor Dashboard

Clinicians can:

- View all patients and triage status.
- See alerts for low adherence, pain/fatigue changes, missed sessions, and weak fingers.
- Review session history, reps, accuracy, pain/fatigue trends, and weakest-finger confidence.
- Assign rehab games and finger exercises.
- Open a live monitor for glove events and calibration bring-up.
- Review AI-assisted summaries and difficulty recommendations.

### Patient Portal

Patients can:

- See their assigned care plan.
- Open a separate Rehab Games catalog.
- Complete guided tutorials before each game.
- Calibrate the glove through live prompts and a 3D hand preview.
- Log pre/post pain and fatigue.
- Save results locally and/or sync them through the backend.
- Track progress through accuracy, reps, symptoms, recent sessions, and game-by-game progress.

## Rehab Games

| Game | Therapy Focus | Input Model |
| --- | --- | --- |
| Ball Pickup | Grip, release, reach control | Camera/pointer movement + calibrated open/fist glove grip. |
| Finger Tap Piano | Finger isolation, timing, rhythm | Raw glove polling + calibrated per-finger tap detection. |
| Bubble Pop | Pointing, pinch precision, visual tracking | Camera/mouse aiming + calibrated point/pinch confirmation. |
| Carrom | Finger extension, force control, aim precision | Camera aiming + calibrated bent-to-straight finger flick release. |

## Tech Stack

### Frontend

- React + TypeScript
- Vite
- Recharts
- React Three Fiber / Three.js
- MediaPipe Tasks Vision
- Supabase client support
- Vitest

### Backend

- Node.js 20+
- Express
- PostgreSQL-backed persistence
- WebSocket live updates with `ws`
- Zod validation
- Supabase token support
- Gemini-backed patient assistant route with deterministic fallbacks

### Hardware Bridge

- Node.js serial bridge
- `serialport`
- Line-delimited JSON parsing
- Backend calibration lookup
- Raw and normalized finger values

## Quick Start

### 1. Backend

Start the API server:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend runs at:

```text
http://127.0.0.1:4000
```

For PostgreSQL mode:

```bash
cd backend
docker compose up -d
npm install
npm run migrate
npm run seed
npm run dev
```

PostgreSQL runs on host port `55432` by default.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs at:

```text
http://127.0.0.1:5173
```

### 3. Serial Bridge

Use this when the ESP32 glove is plugged into the laptop.

```bash
cd bridge
cp .env.example .env
npm install
npm start
```

Configure `.env` with:

```bash
SERIAL_PORT=/dev/tty.usbserial-0001
BACKEND_URL=http://127.0.0.1:4000
PATIENT_ID=demo-patient-1
BAUD_RATE=115200
```

On Windows, `SERIAL_PORT` will look like `COM3`. On macOS/Linux, it will usually look like `/dev/tty.usbserial-*`, `/dev/tty.usbmodem*`, or `/dev/ttyUSB*`.

### 4. ESP32 Firmware

1. Open `esp32/glove.ino` in Arduino IDE.
2. Install the ESP32 board package.
3. Select `ESP32 Dev Module`.
4. Upload the sketch.
5. Open Serial Monitor at `115200` baud to verify JSON output.
6. Start the bridge.

## Environment Variables

### Backend

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | API server port. |
| `DATABASE_URL` | `postgres://gloving:gloving@localhost:55432/gloving` | PostgreSQL connection string. |
| `CORS_ORIGIN` | `http://127.0.0.1:5173` | Frontend origin. |
| `SUPABASE_URL` | unset | Required for authenticated production routes. |
| `SUPABASE_SERVICE_ROLE_KEY` | unset | Backend service key. Do not expose in frontend. |
| `SUPABASE_ANON_KEY` | unset | Supabase anon key for token introspection fallback. |
| `GEMINI_API_KEY` | unset | Optional patient assistant model key. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model name. |

### Frontend

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://127.0.0.1:4000` | Backend REST base URL. |
| `VITE_WS_URL` | `ws://127.0.0.1:4000/ws` | Backend WebSocket URL. |
| `VITE_SUPABASE_URL` | unset | Optional Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | unset | Public Supabase anon key. |

### Bridge

| Variable | Default | Notes |
| --- | --- | --- |
| `SERIAL_PORT` | required | USB serial device path, for example `/dev/tty.usbserial-0001` or `COM3`. |
| `BACKEND_URL` | `http://127.0.0.1:4000` | Backend API URL. |
| `PATIENT_ID` | `demo-patient-1` | Patient whose glove stream should receive events. |
| `BAUD_RATE` | `115200` | Must match ESP32 firmware. |

## API and Realtime Flow

The bridge sends glove frames to:

```http
POST /api/glove/event
```

Payload:

```json
{
  "patientId": "demo-patient-1",
  "gesture": "fist",
  "thumb": 82,
  "index": 91,
  "middle": 88,
  "ring": 76,
  "pinky": 70,
  "rawValues": {
    "thumb": 820,
    "index": 910,
    "middle": 880,
    "ring": 760,
    "pinky": 700
  },
  "timestamp": "2026-04-27T22:30:00.000Z"
}
```

Clients subscribe to live updates over:

```text
ws://127.0.0.1:4000/ws
```

Subscribe by patient:

```json
{ "type": "subscribe", "patientId": "demo-patient-1" }
```

## Demo and Testing

Run the frontend test suite:

```bash
cd frontend
npm run test
```

Build the frontend:

```bash
cd frontend
npm run build
```

Check backend syntax:

```bash
cd backend
npm run check
```

## Repository Map

```text
backend/
  src/server.js              Express API and route registration
  src/realtime.js            WebSocket subscriptions and broadcasts
  src/repositories.js        PostgreSQL-backed repository
  scripts/                   migrate and seed utilities

bridge/
  bridge.js                  USB serial to backend bridge

esp32/
  glove.ino                  ESP32 flex sensor firmware

frontend/
  src/App.tsx                Doctor workspace and app routing
  src/patient/               Patient portal, calibration, games
  src/lib/backend.ts         REST/WebSocket API client
  src/lib/doctorAnalytics.ts Analytics and demo graph data
  src/vr/                    Embedded legacy VR/game components
```

## Why It Matters

Hand therapy only works when patients repeat the right movements consistently and clinicians can see what is happening between appointments. Dextera closes that gap: the glove captures movement, the games make repetition feel purposeful, and the dashboard turns every session into actionable rehab data.
