# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping this file current

Update this file as part of any task that changes how the codebase works. The goal is to keep enough context here that future agents can be productive without re-reading source files. Specifically, update it when:

- A new package, service, or significant module is added or removed
- A new feature is built — summarise what it does, where it lives, and how it connects to the rest of the system
- A dev, build, test, or lint command changes
- The storage mode, environment variables, or ports change
- The data flow or architecture between packages changes
- Key business logic changes (e.g. how reps are counted, how gestures are scored)
- New demo credentials, seed data IDs, or setup steps are introduced
- A known limitation, workaround, or non-obvious constraint is added or resolved

Keep entries concise — only record what is non-obvious or would take multiple file reads to discover. Do not duplicate information already visible from file names or package.json scripts.

## Agent behaviour rules

- **Never `git push` without explicit user instruction.** Commit freely, but only push when the user says to.

## Repository overview

Three independent packages that form a rehab glove pipeline:

```
ESP32 glove  →  backend API + WebSocket  →  frontend dashboard  →  VR game
```

- `backend/` — Node.js/Express + PostgreSQL (or in-memory mock), CommonJS
- `frontend/` — React/TypeScript therapist dashboard (Vite, ESM)
- `vr/` — Standalone React/Three.js VR rehab game (Vite, ESM)

There is no monorepo tooling; run all commands from within each package directory.

## Commands

### Backend

```bash
cd backend
npm install
npm run dev          # nodemon, port 4000
npm run check        # node --check syntax validation (no test runner)
npm run migrate      # create DB schema (requires PostgreSQL)
npm run seed         # seed demo data (requires PostgreSQL)
npm run simulate -- --patient demo-patient-1 --interval 750        # stream fake glove events
npm run simulate -- --patient demo-patient-1 --interval 750 --count 20
```

PostgreSQL (Docker):
```bash
cd backend && docker compose up -d   # starts postgres on host port 55432
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # Vite dev server on http://127.0.0.1:5173
npm run build        # tsc -b && vite build
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch
npm run smoke        # node scripts/smoke.mjs
```

Run a single test file:
```bash
cd frontend && npx vitest run src/lib/gesture.test.ts
```

### VR (standalone)

```bash
cd vr
npm install
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run lint         # eslint (only package with lint configured)
```

### GitHub

```bash
gh repo view MohsinCoding/gloving
gh pr list --repo MohsinCoding/gloving
gh issue list --repo MohsinCoding/gloving
```

## Architecture

### Backend storage modes

`STORAGE_MODE` env var controls which repository is loaded:

- `mock` (default) — `src/mockRepository.js`, fully in-memory with seeded demo data, no DB needed
- `postgres` — `src/repositories.js`, requires Docker PostgreSQL

`src/server.js` selects the repo at startup: `const repo = usingPostgres ? require("./repositories") : require("./mockRepository")`. All route handlers call `repo.*` methods identically regardless of mode.

`src/realtime.js` runs a `ws` WebSocket server on `/ws`. Clients subscribe by patientId or sessionId; gesture events are broadcast immediately on `POST /api/glove/event`.

### Frontend data flow

`src/App.tsx` is a single large component tree. State machine:
1. On mount: `checkBackendHealth()` → if reachable, fetch patients from backend; otherwise fall back to `seedPatients` from `src/data/mockData.ts`
2. If backend connected: open WebSocket via `connectGestureStream()` for live events
3. Built-in simulator (toggle in Live Session view) calls `POST /api/dev/fake-gesture` when backend is up, or generates events locally from `mockData.ts` when offline

Rep counting: a fist→open gesture transition increments `repsCompleted`.

`src/lib/backend.ts` owns all HTTP and WebSocket calls. It maps backend JSON shapes to the frontend's internal types, normalising missing fields and deriving `accuracy`, `holdMs`, and `smoothness` if absent.

`src/lib/gesture.ts` contains pure gesture utilities (classification, accuracy scoring, patient summaries). This is the only tested file (`gesture.test.ts` via Vitest).

Patient portal sign-in in `src/App.tsx` checks backend health independently of the doctor dashboard, then loads `/api/patients/:id/assignments`; local patient identity is persisted in `dextera.localPatientSession.v1` so refreshing `/patient/plan` reloads the same patient's clinician-created rehab game assignments without requiring logout/login.

Clinician-assigned finger exercises use the same refreshable flow: `src/exercises/ExercisesPage.tsx` writes through `/api/exercise-assignments`, and the patient portal loads `/api/patients/:id/exercise-assignments` so drills appear after refreshing the patient dashboard.

### VR — two implementations

The VR game exists in two places:
- `frontend/src/vr/` — embedded in the dashboard. `VrGamePage` receives `currentEvent` as a prop from `App.tsx` and pushes it into the Zustand store.
- `vr/` — standalone app. Has its own `WebSocketGestureAdapter.ts` and `useMockGestureAdapter.ts` to source gesture events independently.

Both share the same game logic: `RehabScene.tsx` (Three.js ball-pickup scene), `SessionHud.tsx`, `gameStore.ts` (Zustand). The standalone `vr/` package can run without the frontend or backend.

### Key env vars (backend `.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `4000` | |
| `DATABASE_URL` | `postgres://gloving:gloving@localhost:55432/gloving` | |
| `STORAGE_MODE` | `mock` | `mock` or `postgres` |
| `CORS_ORIGIN` | `*` | |

Frontend reads `VITE_API_BASE_URL` (default `http://127.0.0.1:4000`) and `VITE_WS_URL` from env.

### Demo data

Seeded by either `npm run seed` (Postgres) or loaded automatically by `mockRepository.js`:
- Patient IDs: `demo-patient-1` (Maya Patel), `demo-patient-2` (Eli Ramos), `demo-patient-3` (Jordan Kim)
- Login: `therapist@demo.local` / `demo-password` (frontend only, no real auth)
