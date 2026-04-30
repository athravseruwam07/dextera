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
ESP32 glove  →  backend API + WebSocket  →  frontend dashboard + embedded rehab games
```

- `backend/` — Node.js/Express + PostgreSQL (or in-memory mock), CommonJS
- `frontend/` — React/TypeScript therapist dashboard (Vite, ESM)
- `frontend/src/vr/` — legacy embedded dashboard VR/game code; no standalone `vr/` package exists in this checkout

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

`src/App.tsx` also owns lightweight History API routing. Public entry points are `/`, `/doctor/sign-in`, and `/patient/sign-in`. Doctor workspace URLs live under `/doctor/...` (`/doctor/dashboard`, `/doctor/patients`, `/doctor/patients/:id/:tab`, `/doctor/appointments`, `/doctor/rehab-games`, `/doctor/exercises`, `/doctor/glove-dev`). Patient portal top-level pages live under `/patient/...` (`/patient/plan`, `/patient/rehab-games`, `/patient/calendar`, `/patient/progress`, `/patient/assistant`). There is no React Router dependency.

Authentication assumes Supabase is configured. Patients can create accounts from `/patient/sign-in` with full name, email, and password; the Supabase user id becomes the patient id in the backend patient profile, so patient login loads only that patient record plus its assignments/appointments/alerts. Doctors cannot self-register in the UI; the single clinic doctor account is `doctor@dextera.app` / `DexteraDoctor2026!` and manages all patients. Provision or reset that account with `cd frontend && $env:SUPABASE_URL="..." ; $env:SUPABASE_SERVICE_ROLE_KEY="..." ; npm run seed:doctor` on PowerShell.

Rep counting: a fist→open gesture transition increments `repsCompleted`.

Live Monitor exercise options come from `exerciseTemplates` in `src/data/mockData.ts`. That list includes the four rehab games plus mapped basic finger drills from `src/data/exercises.ts`, so doctor live sessions can start single-finger and multi-finger exercises from the same dropdown.

`src/lib/backend.ts` owns all HTTP and WebSocket calls. It maps backend JSON shapes to the frontend's internal types, normalising missing fields and deriving `accuracy`, `holdMs`, and `smoothness` if absent. Doctor roster startup uses `fetchBackendPatientSummaries()` first so Patients/Exercises render names quickly, then hydrates full sessions/events in the background with `fetchBackendPatient()`. The backend `/api/patients` query must stay summary-only/pre-aggregated; avoid joining raw sessions/results/events directly because that delays patient dropdowns as glove event volume grows.

Patient Assistant calls `POST /api/ai/patient-chat` through `askPatientAssistant()` in `src/lib/backend.ts`. The backend route uses `backend/src/gemini.js` with `@google/genai` when `GEMINI_API_KEY` is set, defaults to `GEMINI_MODEL=gemini-2.5-flash`, falls back across known Gemini Flash models on 404s, and uses deterministic Dextera answers for exact plan facts like notes, reps, assigned games, known game instructions, scores, and safety-sensitive questions.

`src/lib/gesture.ts` contains pure gesture utilities (classification, accuracy scoring, patient summaries). This is the only tested file (`gesture.test.ts` via Vitest).

Therapist Settings are opened from the top-right gear dropdown, not the sidebar or a dedicated Settings page. Accounts and System Status open focused popups; Sign out remains in the dropdown.

Doctor Dashboard in `src/App.tsx` uses compact top metric tiles and caps the Alerts needing review / Upcoming appointments previews at two items each. `View x+ more` opens a centered scrollable modal that preserves patient navigation actions.

Theme mode is disabled in the UI. `App.tsx` forces `data-theme="light"` and removes the old `dextera.theme` localStorage value on mount so saved dark mode cannot leak into doctor or patient screens. `frontend/src/styles.css` now uses a surgical Rehabilitation Studio theme layer: root tokens remap the legacy palette, scoped component overrides restyle clinician/patient surfaces, and existing page layout rules are preserved rather than rewritten.

Patient portal uses its own shell in `frontend/src/patient/PatientExperience.tsx`: Dextera brand in a left sidebar, vertical Plan / Rehab Games / Calendar / Recovery Progress / Assistant navigation, and a top-right Settings dropdown containing Exit. Plan shows clinician-assigned games and finger exercises; the separate Rehab Games tab always shows the full four-game patient catalog, merging clinician-assigned game settings where present. Recovery Progress uses existing saved patient session results and roster sessions to show patient-facing accuracy, reps, pain/fatigue, game progress, and recent-session trends. Graph previews use `demoGraphSessions()` from `frontend/src/lib/doctorAnalytics.ts` when a patient has fewer than two real sessions, so doctor and patient dashboards stay populated during demos while real saved/backend data still takes precedence.

`src/lib/useGloveData.ts` is the shared live glove subscription hook. It exposes both `normalized` finger bends (0–100) and `rawValues` ADC readings from the same WebSocket event. In `hardwareOnly` mode it ignores simulator traffic, polls `/api/glove/latest`, and only marks the glove connected when raw ESP32 frames are arriving.

`src/App.tsx` includes a therapist-facing `glove-dev` view used for hardware bring-up. It captures OPEN/FIST raw ADC baselines, saves them through `patient/patientApi.ts` to `/api/calibration`, and immediately applies the saved calibration locally for the on-screen percent readout and 3D hand preview. The calibrated values and 3D hand stay locked until a saved calibration exists.

`backend/src/mockRepository.js` keeps `/api/glove/latest` as the last true hardware frame only. Simulator events still broadcast over WebSocket, but they no longer overwrite the latest raw glove sample used by the Glove Dev monitor.

`backend/src/repositories.js` now mirrors the glove bring-up features in Postgres mode. It stores `rawValues` inside `gesture_events.raw`, exposes `getLatestGloveEvent()` by reading the newest row that contains raw glove data, and lazily creates/uses a `glove_calibrations` table for `saveCalibration()` / `getCalibration()`. It also lazily creates legacy rehab-game `assignments` so `/api/assignments` and `/api/patients/:id/assignments` persist clinician game plans in Postgres mode. Without this, the Glove Dev monitor and patient assignment flows cannot work correctly when the backend runs with `STORAGE_MODE=postgres`.

`frontend/public/models/realistic-hand.glb` is the current hand asset used by both the therapist Glove Dev preview and the patient calibration preview. It comes from Poly Pizza’s “Realistic Hand” by J-Toastie (CC-BY 3.0). `frontend/src/vr/components/HandModel3D.tsx` must render it as a separate armature bone tree plus a skinned mesh, matching the GLTF structure, rather than mounting the whole cloned scene as a single primitive. The thumb bones in this asset are named `Bone001`, `Bone002`, and `Bone003` (no dots). Finger motion is applied by slerping from the base pose toward the model’s closed-hand pose per finger using the live calibrated bend percentages. The ring finger intentionally curls only `RingF_lower`, `RingF_middle`, and `RingF_tip`; do not add `RingRoot` back to the bend group because it twists the metacarpal and makes the ring preview look glitchy at high calibrated values.

### Patient-side demo flow

`frontend/src/patient/` contains the patient experience added for the hackathon demo. `PatientExperience.tsx` owns the patient dashboard, assignment detail, tutorial, calibration, pain/fatigue check-ins, results, calendar, and safe mock assistant UI. It is mounted from the existing `App.tsx` view switch via `patient`, `patient-calendar`, and `patient-assistant` views, grouped in the sidebar under **Rehab Games**.

Patient assignments, appointments, tutorials, and local result persistence live in `patientData.ts`; session results are stored in localStorage under `gloving.patient.sessionResults.v1` and also converted to the existing `RehabSession` shape so therapist progress/dashboard views can show saved patient game results. `patientApi.ts` tries the existing backend session start/end endpoints when connected, then always keeps the full patient result locally for the demo. Local fallback saves are marked with `syncStatus: "pending"` and the patient results UI exposes a Retry Sync state; only backend-synced patient sessions are pushed into the clinician chart state.

When a patient signs into the portal, `App.tsx` actively checks backend health even if the doctor dashboard has not loaded yet, then fetches `/api/patients/:id/assignments`; local patient identity is persisted in `dextera.localPatientSession.v1` so refreshing `/patient/plan` reloads the same patient and merges clinician-created rehab game assignments into the full patient game catalog without requiring logout/login.

`frontend/src/data/exercises.ts` defines basic clinician-assignable finger exercises, and `frontend/src/exercises/ExercisesPage.tsx` is the therapist-facing assignment page exposed from the main sidebar as **Exercises**. The page is controlled by App-level `selectedPatientId`, not its own initial patient state, so async patient loading does not leave it stuck on a blank patient. Exercise assignments are persisted through `/api/exercise-assignments` and loaded from `/api/patients/:id/exercise-assignments`, so doctor-side assignment and patient refresh use the same backend-backed flow as rehab game assignments. The Exercises page rolls back optimistic UI and shows the backend error if assignment/removal fails in Supabase-backed mode; local fallback is only for offline/demo mode. Postgres mode stores them in `exercise_assignments` with `status`, `completed_at`, and `result`; `repositories.js` self-heals older tables by removing duplicate patient/exercise rows and adding the unique `(patient_id, exercise_id)` index required by `ON CONFLICT`. `dextera.exerciseAssignments.v1` is a frontend fallback/cache used when the backend is offline. Patient portal home receives those assignments via `PatientExperience`, shows them alongside rehab games, and includes an exercise detail/play/results flow. The play screen uses `patient/input.tsx` live finger bend percentages to count a rep when the target finger group bends and then releases; completing the exercise PATCHes the assignment to `completed`. The **Demo Rep** button emits a local bend/release fallback for demos without glove hardware.

`patient/input.tsx` is the shared patient input abstraction. It exposes the current gesture, finger bends, raw glove values, hand position, and event history. Patient-facing input is Smart Glove only; when no glove stream is available, the provider emits local demo gesture events without moving the hand position so localhost demos do not auto-drift. `patient/gameRegistry.ts` is the patient-game manifest that maps each game to its glove mode, calibration requirements, fullscreen need, audio flag, and expected metrics. The provider has game-specific hardware modes: Ball Pickup uses calibrated open/fist only, and Finger Tap uses raw glove polling plus calibrated per-finger tap detection to emit `tap_*` events. Other patient games still support `tap` and `flick` gestures in addition to the original glove gestures. Patient calibration is a guided live sequence: Start Calibration, hold each prompted shape for 3 seconds, and watch the live 3D hand preview while fresh unique raw samples are averaged and quality-checked for that target.

The four patient games live in `PatientGames.tsx`: Ball Pickup, Finger Tap Piano, Bubble Pop, and Carrom. Ball Pickup uses React Three Fiber inside the patient game flow with a simple mesh hand, table, ball, and basket. For Ball Pickup, `PatientExperience.tsx` only captures OPEN and FIST before play, saves those raw baselines through `/api/calibration`, and passes the calibration into `patient/input.tsx`; live raw glove frames are converted to calibrated bend percentages and classified locally. `patient/ballPickupGrip.ts` owns the dedicated open/fist grip logic: it ignores non-raw synthetic events in Ball Pickup mode, accepts the bridge's default `demo-patient-1` raw stream, averages raw samples for calibration captures, and uses hysteresis plus consecutive-frame confirmation before changing between open and fist. Ball Pickup has an explicit start/countdown flow and only moves, grabs, or times the round after the round starts. Finger Tap Piano uses `patient/fingerTapInput.ts` to build calibrated per-finger movement factors from the patient's tap captures, then classifies live raw frames by each finger's current bend divided by that finger's calibrated tap value. Easy/Medium classic and Hard falling-lanes modes score those generated `tap_*` events directly, while pointer/keyboard controls are only local fallback when the glove is not connected. `patient/pianoAudio.ts` provides Web Audio note feedback for Finger Tap Piano with persisted mute state. Every patient game that needs hand-position movement uses camera tracking by default except Finger Tap Piano; Ball Pickup, Bubble Pop, and Carrom each provide an explicit mouse-mode toggle and auto-pause during active player movement when MediaPipe no longer sees the hand. Bubble Pop is a 2.5D DOM game on a layered animated board: captured point/pinch calibration is used for glove classification, held point/pinch or demo Space/Enter can confirm pops, bubbles drift and animate before delayed replacement, and `patient/bubblePop3D.ts` keeps replacements away from active bubbles, the popped spot, and the cursor. Carrom is a 3D React Three Fiber game with start/game/end screens, random player/AI break, real 9-white/9-black/queen setup, side-specific striker baseline placement, pocket physics, queen cover/return handling, fouls/penalties, AI opponent, board-only fullscreen, and trackpad drag-release shooting when no glove is connected. Carrom camera mode uses open hand for striker placement, fist to lock placement, a 2-second frozen pause, palm aiming, fist to lock direction, another 2-second frozen pause, then calibrated bent-to-straight finger flick speed for release power; mouse mode keeps drag-release and bridge `flick` events remain supported outside camera mode. Carrom loads `frontend/src/assets/carrom_board_optimized.glb` via `useGLTF` (pre-optimized for web), and prunes/hides non-board meshes at runtime (based on largest-geometry heuristic) so only the playable board surfaces render. Gameplay coins use a Planck.js 2D physics simulation for collisions and pocket detection. AI difficulty comes from the assignment config, and the Carrom end screen also surfaces rehab-style aim metrics sampled during player aim drags. Carrom can only be played fullscreen; leaving fullscreen pauses and shows a resume overlay, and all score/turn/power/rule feedback is inside the game board. Aiming uses a green forward arrow for shot direction and a red rear power line; camera mode bases the red line on live flick-power preview. Game completion payloads may include `gameMetrics` for per-game details such as failed drops, misses by finger, Bubble Pop wrong hits/streaks, and Carrom aim/foul/flick metrics. `PatientExperience.tsx` also has a testing shortcut on assignment detail/calibration screens that skips calibration/check-in and jumps into the selected game with mock baseline data.

Carrom calibration now includes a 3-rep index/middle finger flick capture after open/fist. The first significant finger extension chooses whether the patient uses index or middle, then calibration counts three clear flicks from that same finger. `CalibrationData.carromFlickProfile` stores the chosen finger plus comfortable/min/max extension speeds from glove bend sensors, and `CarromGame` uses that calibrated bent-to-straight speed for release power. Camera tracking is only for palm aiming/striker placement in camera mode. Fist gestures lock placement and direction; timed pauses separate those locks from the next movement so prior hand posture cannot advance the flow.

### VR

The current checkout only includes `frontend/src/vr/`, the legacy embedded dashboard VR code. It is no longer exposed in the main sidebar to avoid duplicating the patient Ball Pickup game. Older notes may refer to a standalone `vr/` package, but that package is not present in this checkout.

### Key env vars (backend `.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `4000` | |
| `DATABASE_URL` | `postgres://gloving:gloving@localhost:55432/gloving` | |
| `STORAGE_MODE` | `mock` | `mock` or `postgres` |
| `CORS_ORIGIN` | `*` | |
| `SUPABASE_URL` | | Required for authenticated API routes in Postgres/prod mode |
| `SUPABASE_SERVICE_ROLE_KEY` | | Preferred backend token verification key; never expose to frontend |
| `SUPABASE_ANON_KEY` | | Backend fallback for Supabase Auth token introspection if no service role key is set |
| `SUPABASE_JWT_SECRET` | | Optional legacy HS256 JWT verification secret; newer asymmetric Supabase tokens use `SUPABASE_URL` + API key instead |

Frontend reads `VITE_API_BASE_URL` (default `http://127.0.0.1:4000`) and `VITE_WS_URL` from env.

### Demo data

Seeded by either `npm run seed` (Postgres) or loaded automatically by `mockRepository.js`:
- Patient IDs: `demo-patient-1` (Maya Patel), `demo-patient-2` (Eli Ramos), `demo-patient-3` (Jordan Kim)
- Doctor login for Supabase-backed mode: `doctor@dextera.app` / `DexteraDoctor2026!` (create this user in Supabase Auth before production use)
