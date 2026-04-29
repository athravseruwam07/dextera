# Gloving Rehab MVP

Gloving is a rehab glove MVP with this software pipeline:

```text
ESP32 Glove
  -> sends gesture data
  -> Backend API/database
  -> Therapist web dashboard
  -> VR-style rehab game in browser

Fake glove simulator
  -> sends test gesture data
  -> backend/web app can be built before glove works
```

## Backend

The backend lives in `backend/` and provides the API, PostgreSQL persistence, WebSocket live updates, seed data, and fake gesture tooling needed by the dashboard and browser game.

### Stack

- Node.js 20+
- Express
- PostgreSQL
- `ws` WebSocket server
- Zod request validation

### Backend Features

- Saves glove gesture events from the ESP32 or simulator
- Attaches gesture events to the active patient session when one exists
- Broadcasts live gesture updates to connected web clients
- Supports fake gesture events before the hardware is ready
- Tracks patients, gloves, sessions, exercises, gesture events, and exercise results
- Provides progress data for therapist dashboards

### Database Tables

- `therapists`
- `patients`
- `gloves`
- `sessions`
- `gesture_events`
- `exercises`
- `exercise_results`

### Main API Routes

- `GET /health`
- `POST /api/glove/event`
- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:id`
- `GET /api/patients/:id/sessions`
- `GET /api/patients/:id/progress`
- `POST /api/sessions/start`
- `POST /api/sessions/:id/end`
- `GET /api/sessions/:id/events`
- `GET /api/exercises`
- `POST /api/exercises`
- `POST /api/exercise-results`
- `POST /api/dev/fake-gesture`

### Gesture Event Payload

The glove or simulator sends:

```json
{
  "patientId": "demo-patient-1",
  "gesture": "fist",
  "thumb": 82,
  "index": 91,
  "middle": 88,
  "ring": 76,
  "pinky": 70,
  "timestamp": "2026-04-27T22:30:00Z"
}
```

Supported gestures:

- `open`
- `fist`
- `pinch`
- `point`
- `unknown`

Finger values must be integers from `0` to `100`, where `0` means straight and `100` means fully bent.

### WebSocket Live Updates

WebSocket endpoint:

```text
ws://localhost:4000/ws
```

Subscribe to a patient:

```json
{ "type": "subscribe", "patientId": "demo-patient-1" }
```

Subscribe to a session:

```json
{ "type": "subscribe", "sessionId": "session-uuid" }
```

Live gesture messages look like:

```json
{
  "type": "gesture:event",
  "event": {
    "id": "event-uuid",
    "patientId": "demo-patient-1",
    "sessionId": "session-uuid",
    "gesture": "fist",
    "thumb": 82,
    "index": 91,
    "middle": 88,
    "ring": 76,
    "pinky": 70,
    "accuracy": 94,
    "timestamp": "2026-04-27T22:30:00.000Z"
  }
}
```

### Local Backend Setup

```bash
cd backend
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run seed
npm run dev
```

API server:

```text
http://localhost:4000
```

PostgreSQL runs on host port `55432` by default to avoid conflicts with a local Postgres install on `5432`.

### Fake Glove Testing

Create one fake gesture event:

```bash
curl -X POST http://localhost:4000/api/dev/fake-gesture
```

Stream fake glove events:

```bash
cd backend
npm run simulate -- --patient demo-patient-1 --interval 750
```

Limit the simulator to a fixed number of events:

```bash
npm run simulate -- --patient demo-patient-1 --interval 750 --count 20
```

### Demo Data

`npm run seed` creates:

- Therapist: `therapist@example.com`
- Patient: `demo-patient-1`
- Exercise: `Ball Pickup Exercise`
- Exercise: `Point Select Drill`

### Backend Verification

Run syntax checks:

```bash
cd backend
npm run check
```

The current implementation has been syntax-checked with:

```bash
npm run check
```

Docker was not available in the Codex environment used to build this, so migrations and seed commands should be run on a machine with Docker or a local PostgreSQL instance.
