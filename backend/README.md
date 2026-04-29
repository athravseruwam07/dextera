# Gloving Backend

Node.js + Express backend for the rehab glove MVP.

## What is included

- REST API for patients, sessions, gesture events, exercises, and exercise results
- PostgreSQL schema for therapists, patients, gloves, sessions, gesture events, exercises, and exercise results
- WebSocket live gesture broadcasts for the therapist dashboard and browser rehab game
- Fake gesture endpoint and simulator CLI so frontend work can start before the glove works
- Seed data for `demo-patient-1`

## Run locally

The backend defaults to in-memory mock storage so the frontend, VR game, and API can run before the physical glove or PostgreSQL setup is ready.

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:4000`

WebSocket: `ws://localhost:4000/ws`

To use PostgreSQL-backed storage instead of mock data:

```bash
cd backend
cp .env.example .env
docker compose up -d
# set STORAGE_MODE=postgres in .env
npm run migrate
npm run seed
npm run dev
```

PostgreSQL runs on host port `55432` by default to avoid conflicts with a local Postgres install on `5432`.

## WebSocket subscriptions

Send one of these after connecting:

```json
{ "type": "subscribe", "patientId": "demo-patient-1" }
```

```json
{ "type": "subscribe", "sessionId": "session-uuid" }
```

Clients receive messages shaped like:

```json
{
  "type": "gesture:event",
  "event": {
    "id": "event-uuid",
    "patientId": "demo-patient-1",
    "gesture": "fist",
    "thumb": 82,
    "index": 91,
    "middle": 88,
    "ring": 76,
    "pinky": 70,
    "timestamp": "2026-04-27T22:30:00.000Z"
  }
}
```

## Main routes

- `GET /health`
- `POST /api/glove/event`
- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:id`
- `GET /api/patients/:id/sessions`
- `POST /api/sessions/start`
- `POST /api/sessions/:id/end`
- `GET /api/sessions/:id/events`
- `GET /api/exercises`
- `POST /api/exercises`
- `POST /api/exercise-results`
- `GET /api/patients/:id/progress`
- `POST /api/dev/fake-gesture`

## Fake glove testing

Generate one event:

```bash
curl -X POST http://localhost:4000/api/dev/fake-gesture
```

Stream fake events:

```bash
npm run simulate -- --patient demo-patient-1 --interval 750
```
