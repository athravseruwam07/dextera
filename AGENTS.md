# AGENTS.md

This file provides guidance to OpenAI Codex when working with code in this repository.

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

The app/product brand is Dextera.

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
npm run seed:doctor  # create/update Supabase doctor user; requires SUPABASE_SERVICE_ROLE_KEY
```

Run a single test file:
```bash
cd frontend && npx vitest run src/lib/gesture.test.ts
```

### VR

There is no standalone `vr/` package in this checkout. Use the frontend commands for the embedded VR code under `frontend/src/vr/`.

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

`src/App.tsx` also owns lightweight History API routing. Public entry points are `/`, `/doctor/sign-in`, and `/patient/sign-in`. Doctor workspace URLs live under `/doctor/...` (`/doctor/dashboard`, `/doctor/patients`, `/doctor/patients/:id/:tab`, `/doctor/appointments`, `/doctor/rehab-games`, `/doctor/exercises`, `/doctor/glove-dev`). Patient portal top-level pages live under `/patient/...` (`/patient/plan`, `/patient/calendar`, `/patient/progress`, `/patient/assistant`). There is no React Router dependency.

Authentication assumes Supabase is configured. Patients can create accounts from `/patient/sign-in` with full name, email, and password; the Supabase user id becomes the patient id in the backend patient profile, so patient login loads only that patient record plus its assignments/appointments/alerts. Doctors cannot self-register in the UI; the single clinic doctor account is `doctor@dextera.app` / `DexteraDoctor2026!` and manages all patients. Provision or reset that account with `cd frontend && $env:SUPABASE_URL="..." ; $env:SUPABASE_SERVICE_ROLE_KEY="..." ; npm run seed:doctor` on PowerShell.

Rep counting: a fist→open gesture transition increments `repsCompleted`.

Live Monitor exercise options come from `exerciseTemplates` in `src/data/mockData.ts`. That list includes the four rehab games plus mapped basic finger drills from `src/data/exercises.ts`, so doctor live sessions can start single-finger and multi-finger exercises from the same dropdown.

`src/lib/backend.ts` owns all HTTP and WebSocket calls. It maps backend JSON shapes to the frontend's internal types, normalising missing fields and deriving `accuracy`, `holdMs`, and `smoothness` if absent.

`src/lib/gesture.ts` contains pure gesture utilities (classification, accuracy scoring, patient summaries). This is the only tested file (`gesture.test.ts` via Vitest).

Therapist Settings are opened from the top-right gear dropdown, not the sidebar or a dedicated Settings page. Accounts and System Status open focused popups; Sign out remains in the dropdown.

Doctor Dashboard in `src/App.tsx` uses compact top metric tiles and caps the Alerts needing review / Upcoming appointments previews at two items each. `View x+ more` opens a centered scrollable modal that preserves patient navigation actions.

Theme mode is disabled in the UI. `App.tsx` forces `data-theme="light"` and removes the old `dextera.theme` localStorage value on mount so saved dark mode cannot leak into doctor or patient screens. `frontend/src/styles.css` now uses a surgical Rehabilitation Studio theme layer: root tokens remap the legacy palette, scoped component overrides restyle clinician/patient surfaces, and existing page layout rules are preserved rather than rewritten.

Patient portal uses its own shell in `frontend/src/patient/PatientExperience.tsx`: Dextera brand in a left sidebar, vertical Plan / Calendar / Recovery Progress / Assistant navigation, and a top-right Settings dropdown containing Exit. Recovery Progress uses existing saved patient session results and roster sessions to show patient-facing accuracy, reps, pain/fatigue, game progress, and recent-session trends.

`src/lib/useGloveData.ts` is the shared live glove subscription hook. It exposes both `normalized` finger bends (0–100) and `rawValues` ADC readings from the same WebSocket event. In `hardwareOnly` mode it ignores simulator traffic, polls `/api/glove/latest`, and only marks the glove connected when raw ESP32 frames are arriving.

`src/App.tsx` includes a therapist-facing `glove-dev` view used for hardware bring-up. It captures OPEN/FIST raw ADC baselines, saves them through `patient/patientApi.ts` to `/api/calibration`, and immediately applies the saved calibration locally for the on-screen percent readout and 3D hand preview. The calibrated values and 3D hand stay locked until a saved calibration exists.

`backend/src/mockRepository.js` keeps `/api/glove/latest` as the last true hardware frame only. Simulator events still broadcast over WebSocket, but they no longer overwrite the latest raw glove sample used by the Glove Dev monitor.

`backend/src/repositories.js` now mirrors the glove bring-up features in Postgres mode. It stores `rawValues` inside `gesture_events.raw`, exposes `getLatestGloveEvent()` by reading the newest row that contains raw glove data, and lazily creates/uses a `glove_calibrations` table for `saveCalibration()` / `getCalibration()`. Without this, the Glove Dev monitor cannot enable capture buttons when the backend runs with `STORAGE_MODE=postgres`.

`frontend/public/models/realistic-hand.glb` is the current hand asset used by both the therapist Glove Dev preview and the patient calibration preview. It comes from Poly Pizza’s “Realistic Hand” by J-Toastie (CC-BY 3.0). `frontend/src/vr/components/HandModel3D.tsx` must render it as a separate armature bone tree plus a skinned mesh, matching the GLTF structure, rather than mounting the whole cloned scene as a single primitive. The thumb bones in this asset are named `Bone001`, `Bone002`, and `Bone003` (no dots). Finger motion is applied by slerping from the base pose toward the model’s closed-hand pose per finger using the live calibrated bend percentages. The ring finger intentionally curls only `RingF_lower`, `RingF_middle`, and `RingF_tip`; do not add `RingRoot` back to the bend group because it twists the metacarpal and makes the ring preview look glitchy at high calibrated values.

### Patient-side demo flow

`frontend/src/patient/` contains the patient experience added for the hackathon demo. `PatientExperience.tsx` owns the patient dashboard, assignment detail, tutorial, calibration, pain/fatigue check-ins, results, calendar, and safe mock assistant UI. It is mounted from the existing `App.tsx` view switch via `patient`, `patient-calendar`, and `patient-assistant` views, grouped in the sidebar under **Rehab Games**.

Patient assignments, appointments, tutorials, and local result persistence live in `patientData.ts`; session results are stored in localStorage under `gloving.patient.sessionResults.v1` and also converted to the existing `RehabSession` shape so therapist progress/dashboard views can show saved patient game results. `patientApi.ts` tries the existing backend session start/end endpoints when connected, then always keeps the full patient result locally for the demo.

`frontend/src/data/exercises.ts` defines basic clinician-assignable finger exercises, and `frontend/src/exercises/ExercisesPage.tsx` is the therapist-facing assignment page exposed from the main sidebar as **Exercises**. Exercise assignments are held in frontend state only. Patient portal home receives those assignments via `PatientExperience`, shows them alongside rehab games, and includes an exercise detail/play/results flow. The play screen uses `patient/input.tsx` live finger bend percentages to count a rep when the target finger group bends and then releases; the **Demo Rep** button emits a local bend/release fallback for demos without glove hardware.

`patient/input.tsx` is the shared patient input abstraction. It exposes the current gesture, finger bends, raw glove values, hand position, and event history. Patient-facing input is Smart Glove only; when no glove stream is available, the provider emits local demo gesture events without moving the hand position so localhost demos do not auto-drift. `patient/gameRegistry.ts` is the patient-game manifest that maps each game to its glove mode, calibration requirements, fullscreen need, audio flag, and expected metrics. The provider has game-specific hardware modes: Ball Pickup uses calibrated open/fist only, and Finger Tap uses raw glove polling plus calibrated per-finger tap detection to emit `tap_*` events. Other patient games still support `tap` and `flick` gestures in addition to the original glove gestures. Patient calibration is a guided live sequence: Start Calibration, hold each prompted shape for 3 seconds, and watch the live 3D hand preview while fresh unique raw samples are averaged and quality-checked for that target.

The four patient games live in `PatientGames.tsx`: Ball Pickup, Finger Tap Piano, Bubble Pop, and Carrom. Ball Pickup uses React Three Fiber inside the patient game flow with a simple mesh hand, table, ball, and basket. For Ball Pickup, `PatientExperience.tsx` only captures OPEN and FIST before play, saves those raw baselines through `/api/calibration`, and passes the calibration into `patient/input.tsx`; live raw glove frames are converted to calibrated bend percentages and classified locally. `patient/ballPickupGrip.ts` owns the dedicated open/fist grip logic: it ignores non-raw synthetic events in Ball Pickup mode, accepts the bridge's default `demo-patient-1` raw stream, averages raw samples for calibration captures, and uses hysteresis plus consecutive-frame confirmation before changing between open and fist. Ball Pickup has an explicit start/countdown flow and only moves, grabs, or times the round after the round starts. Finger Tap Piano uses `patient/fingerTapInput.ts` to build calibrated per-finger movement factors from the patient's tap captures, then classifies live raw frames by each finger's current bend divided by that finger's calibrated tap value. Easy/Medium classic and Hard falling-lanes modes score those generated `tap_*` events directly, while pointer/keyboard controls are only local fallback when the glove is not connected. `patient/pianoAudio.ts` provides Web Audio note feedback for Finger Tap Piano with persisted mute state. Bubble Pop now has explicit start/pause/restart/end controls; pointer clicks are demo fallback only when raw glove input is not connected, and calibrated glove point/pinch gestures are the intended pop confirmation. Carrom is a 3D React Three Fiber game with start/game/end screens, random player/AI break, real 9-white/9-black/queen setup, side-specific striker baseline placement, pocket physics, queen cover/return handling, fouls/penalties, AI opponent, board-only fullscreen, and trackpad drag-release shooting when no glove is connected. Carrom also accepts a calibrated fist-to-open release as the glove shooting gesture after pointer aiming, while bridge `flick` events remain supported. Carrom loads `frontend/src/assets/carrom_board_optimized.glb` via `useGLTF` (pre-optimized for web), and prunes/hides non-board meshes at runtime (based on largest-geometry heuristic) so only the playable board surfaces render. Gameplay coins use a Planck.js 2D physics simulation for collisions and pocket detection. AI difficulty comes from the assignment config, and the Carrom end screen also surfaces rehab-style aim metrics sampled during player aim drags. Carrom can only be played fullscreen; leaving fullscreen pauses and shows a resume overlay, and all score/turn/power/rule feedback is inside the game board. Aiming uses a green forward arrow for shot direction and a red rear pullback line for release stretch. Game completion payloads may include `gameMetrics` for per-game details such as failed drops, misses by finger, Bubble Pop wrong hits, and Carrom aim/foul metrics. `PatientExperience.tsx` also has a testing shortcut on assignment detail/calibration screens that skips calibration/check-in and jumps into the selected game with mock baseline data.

### VR

The current checkout only includes `frontend/src/vr/`, the legacy embedded dashboard VR code. It is no longer exposed in the main sidebar to avoid duplicating the patient Ball Pickup game. Older notes may refer to a standalone `vr/` package, but that package is not present in this checkout.

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
- Doctor login for Supabase-backed mode: `doctor@dextera.app` / `DexteraDoctor2026!` (create this user in Supabase Auth before production use)
