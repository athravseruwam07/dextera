# Gloving Web App

Therapist dashboard for the ESP32 glove project.

This repo intentionally implements only the web app track:

- therapist login shell
- patient list and profile
- live session screen with finger bend bars
- progress dashboard with charts
- exercise builder
- fake glove simulator so the app works before hardware and backend are ready

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5173`.

## Test

```bash
npm run test
npm run build
npm run smoke
```

The app keeps all data in memory for now. The simulator emits the same JSON shape the backend/glove team plans to send:

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

## Backend Integration Points

Replace the fake stream in `src/App.tsx` with:

- WebSocket subscription for live gesture events
- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:id/sessions`
- `POST /api/sessions/start`
- `POST /api/sessions/:id/end`
- `GET /api/sessions/:id/events`

The UI is already typed around those entities in `src/types.ts`.
