# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The spec is `PRD.md` (in Korean). Sections 1–5 are the product requirements. Sections 6–12 are the agreed technical plan: architecture, file structure, Prisma schema, API spec, Docker, Azure Container Apps deployment, and roadmap. Roadmap steps 1–5 are done: scaffold; schema, migration, and seed; the backend API with tests; the four UI screens; and Docker with Playwright E2E. CI exists (`.github/workflows/ci.yml`, see below). Only step 6, Azure Container Apps deployment and the CD workflow (PRD §11), remains. The repo is on GitHub at `cloudhong67-bot/Study-03` (branch `main`, LF line endings enforced by `.gitattributes`), and pushes to `main` and PRs trigger CI. PRD §9 documents the API exactly as implemented, so update it when you change a response shape.

`PRD.md` is the source of truth for requirements. Read it before you implement a feature. Keep user-facing text in Korean to match the spec.

## Stack and commands

- The stack is a single Next.js 15 (App Router, `output: 'standalone'`, `src/` dir, `@/*` → `src/*`) + TypeScript + Tailwind CSS v4 app that serves both the pages and the `/api/*` routes. It uses Prisma 6 (`prisma-client-js`) with PostgreSQL 16 and zod 4. The plan is to run it as one container on Azure Container Apps, backed by Azure PostgreSQL Flexible Server; it is **not deployed yet** (PRD §11, roadmap step 6).
- `npm run dev` / `build` / `start` / `lint`.
- `npm run lint` runs **both** checks in order and stops at the first failure:
  - `lint:next` (`eslint`, ESLint 9 flat config `eslint.config.mjs`, Next rules)
  - `lint:hooks` (react-hooks v7 `recommended-latest`, i.e. React Compiler rules such as `refs`, `set-state-in-effect`, `purity`; it uses `eslint.hooks.config.mjs` with `--max-warnings 0`)
- Run either check alone by name. Arguments after `npm run lint --` reach only the last command, so for autofix run `npx eslint --fix` directly.
- `next build` runs only Next's own lint (and type checking), not `lint:hooks`.
- `npm run typecheck` runs `tsc --noEmit` (CI uses it).
- `npm test` runs Vitest once (`tests/unit/**/*.test.ts`). Run a single file with `npx vitest run tests/unit/scoring.test.ts`, filter by test name with `-t "<name>"`, and use `npm run test:watch` for watch mode. **The suite needs the compose DB running** (`docker compose up -d db`), because `*.integration.test.ts` hits a real database.
- Local DB: `docker compose up -d db` starts Postgres 16 on **host port 5433**, because 5432 is often taken by a local Postgres. Copy `.env.example` to `.env` for `DATABASE_URL`.
- DB scripts:
  - `npm run db:migrate` (`prisma migrate dev`)
  - `npm run db:seed` (`node prisma/seed.mjs`)
  - `npm run db:generate` (also runs on `postinstall`)
- Use the `PrismaClient` singleton in `src/lib/prisma.ts`.
- Full stack in containers:
  - `npm run local:up` (`docker compose up --build --detach --wait`) builds and starts db plus app, and returns once both are healthy. The app is on **http://127.0.0.1:3001**.
  - `npm run local:down` stops them and keeps the DB volume (add `-v` via `docker compose down -v` only to wipe data).
  - `npm run local:logs` follows the app logs (last 100 lines, then streams; Ctrl+C to exit).
  - Override the app port with `APP_PORT`. Use `127.0.0.1`, not `localhost`, because on this machine `[::1]:3000` is held by a WSL service.
- E2E: `npm run test:e2e` (Playwright) runs against the compose app, so start the stack first. Run one test with `npx playwright test -g "<name>"`. Point `E2E_BASE_URL` at another target to test it instead. The first time on a machine, run `npx playwright install chromium`.

## CI (`.github/workflows/ci.yml`)

- **Triggers:** PRs, pushes to `main`, and manual dispatch. A newer push cancels the running job for the same ref. Permissions are read-only.
- **`quality` job:** `npm ci` → `npm run lint` (both checks) → `npm run typecheck` → `npm test` → `npm run build`. Integration tests use a `postgres:16` service container on 5432, and vitest derives `trivia_test` from `DATABASE_URL` as it does locally.
- **`e2e` job** (needs `quality`): `docker compose up --build --detach --wait` (waits for both healthchecks) → `npx playwright install --with-deps chromium` → `npm run test:e2e` → `docker compose down --volumes`. On failure it uploads `playwright-report/`, `test-results/`, and the compose logs (7 days).
  - `DATABASE_URL` points at the compose DB (127.0.0.1:5433) so E2E global setup and teardown clean up as they do locally.
  - Under `GITHUB_ACTIONS`, Playwright adds the `github` reporter, which annotates the PR.
- **Keep CI and local commands identical.** If you add a check, add an npm script and call it from the workflow.
- **Validate workflow edits** with `actionlint` (for example `docker run --rm -v <repo>:/repo -w /repo rhysd/actionlint:1.7.7 .github/workflows/ci.yml`). Both jobs were rehearsed locally from a clean copy (no `.env`, no `node_modules`) with `CI=true`.
- **Not covered yet:**
  - Docker layer and Playwright browser caching
  - `npm audit` (it currently reports advisories that need Next 16 / Prisma 7)
  - Pinning actions to commit SHAs
  - The deploy workflow

## Docker and E2E

- `Dockerfile` (node:22-alpine):
  - `deps` runs `npm ci --ignore-scripts`, because `postinstall` would run `prisma generate` before the schema is copied.
  - `runner` copies only the standalone output plus `prisma/` and a separately installed Prisma CLI (`/app/prisma-cli`, used for `migrate deploy`), and runs as the non-root `node` user.
  - Don't copy all of `node_modules/@prisma/client` into the runner. Standalone tracing already includes the client and the musl engine, and the full package adds about 70MB of unused per-database wasm runtimes.
- `docker-entrypoint.sh` runs `migrate deploy`, then the seed (only when `RUN_SEED=true`, which compose sets), then `exec node server.js`. Keep it LF; `.gitattributes` enforces that.
- To seed manually inside the container, run `docker compose exec app node prisma/seed.mjs`. Don't use `npx prisma db seed`: the runtime image has no Prisma CLI on `PATH`, so `npx` would download Prisma at runtime. Running `npm run db:seed` on the host reaches the same DB on 5433.
- Inside the container the server listens on IPv4 `0.0.0.0:3000`, and Alpine resolves `localhost` to `::1` first, so in-container probes must use `127.0.0.1`, as the compose healthcheck does. On the host, `localhost:3000` is a different WSL app (`{"ok":true}`), not this one (`{"status":"ok"}`).
- After changing the Dockerfile, verify migrations against an **empty** database, not just the dev volume, which is already migrated. For example, run the image on the compose network with `DATABASE_URL=…/trivia_fresh` after `CREATE DATABASE trivia_fresh`.
- The E2E suite lives in `tests/e2e/`, with shared helpers in `fixtures.ts`, for example `answerAndVerify`.
  - Answers aren't known in advance, so tests read the feedback from the UI: option accessible names end with `(정답)` or `(선택한 오답)` after grading.
  - E2E nicknames use the `E2E-` prefix. When targeting the local stack, `global-teardown.ts` deletes the sessions it created and the `E2E-` scores through Prisma, using `DATABASE_URL` from `.env`. Otherwise leaderboard rows pile up and new entries fall out of the Top 50.
- Vitest only picks up `tests/unit/**`, and Playwright only `tests/e2e/**`.

## Backend architecture

- **Module layout (dependencies point downward, never up):**
  - `src/app/**`: routes and pages (thin)
  - `src/lib/quiz/*`: the domain
    - `sessions.ts`: create, open question (`openQuestion`), 50:50 hint (`requestHint`), answer, result, expiry, cleanup
    - `scores.ts`: submit, rank, leaderboard
    - `categories.ts`
    - `summary.ts`: pure result aggregation
  - Infrastructure and shared modules:
    - `errors.ts`: `AppError` and its codes
    - `db-errors.ts`: Prisma error classification
    - `prisma.ts`: client and `checkDatabase`
    - `rate-limit.ts` and `client-ip.ts`
    - `api.ts`: HTTP mapping and body reading
    - `async.ts`, `shuffle.ts`, `scoring.ts`, `hint.ts`, `limits.ts`, `validation.ts`, `leaderboard-period.ts`
  - Infrastructure must not import the domain. The only exceptions are `api.ts` reusing `sessionNotFound` and `maintenance.ts` calling `cleanupExpiredSessions`.
- **Route handlers** (`src/app/api/**/route.ts`) stay thin: check the rate limit if needed, `parseJson(request, schema)` / `readSessionId(context)`, call one domain function, and wrap it all in `handle()` from `src/lib/api.ts`.
  - `handle()` turns `ZodError` into 400, `AppError` into its code (`BAD_REQUEST` 400, `NOT_FOUND` 404, `REQUEST_TIMEOUT` 408, `CONFLICT` 409, `PAYLOAD_TOO_LARGE` 413, `TOO_MANY_REQUESTS` 429), and transient DB errors into 503. Anything else becomes a logged 500.
  - To choose a success status per call, return `new WithStatus(body, status)`.
  - Put business rules in `src/lib/quiz/*` and throw `AppError` there. Reuse the local error factories (`sessionNotFound()`, `alreadyAnswered()`, …) instead of repeating message strings.
- Pure logic (`shuffle`, `buildResultSummary`/`scoreSession`, `pickFiftyFiftyRemovals`, and `scoring.ts`) is separate from the Prisma calls so it can be unit-tested without a DB. `shuffle`, `createSession`, and `requestHint` take an injectable `random`.
- Duplicate answers and duplicate score submissions are rejected by DB unique constraints. The service catches Prisma `P2002` and turns it into 409 instead of relying on a check-then-insert, so concurrent requests are safe too. Keep it that way.
- `[id]` routes get `params` as a Promise (Next 15). Use `readSessionId(context)`, which also maps a non-UUID id to 404.
- Route handlers that never read the request (`categories`, `health`) set `export const dynamic = "force-dynamic"`, so `next build` doesn't prerender them or hit the DB.

## Frontend architecture

- **Data flow:**
  - Server-rendered pages (`/`, `/leaderboard`, `/result/[sessionId]`) call `src/lib/quiz/*` functions directly, not their own `/api/*` routes, and they're `force-dynamic` or dynamic through `searchParams`. Run independent loads in parallel (`Promise.all`).
  - Only interactive parts are client components, colocated with their page: `MainMenu.tsx`, `quiz/QuizRunner.tsx`, `result/[sessionId]/ScoreSubmitForm.tsx`, `result/[sessionId]/SaveLocalResult.tsx`, and `records/RecordsView.tsx`. They talk to the server through `postJson` (`src/lib/http-client.ts`) to the `/api/*` routes.
  - Use `src/lib/page-helpers.ts` in pages: `orNotFound(promise)` maps domain `NOT_FOUND` to `notFound()`, and `flattenSearchParams` / `firstParam` normalize query params.
- **API types:** never hand-write response types on the client. Derive them on the server (`CreatedSession`, `AnswerFeedback`, `QuizResult` in `quiz/sessions.ts`; `SubmittedScore`, `LeaderboardEntry` in `quiz/scores.ts`) and use `import type` on the client.
- **Status screens:** error, 404, and "couldn't start" screens use `src/components/StatusMessage.tsx` (icon, title, message, action buttons). Don't hand-build new ones.
- **Client bundles:** don't import `validation.ts` or `src/lib/quiz/*` (values, not types) from client components, because that pulls zod or Prisma into the browser. Shared constants go in `src/lib/limits.ts`. Type-only imports such as `QuizResult` or `LeaderboardEntry` are fine.
- **Quiz screen structure:** `QuizRunner.tsx` only renders. The logic is split across:
  - `quiz/quiz-state.ts`: a pure reducer with `canSelect`, `canUseHint`, `answerToRetry`, `shouldWatchDeadline`, `currentQuestion`, and `isLastQuestion`; unit-tested in `tests/unit/quiz-state.test.ts`. Add state transitions here, not as new `useState`s. `opened` and `hintReceived` carry the `questionId` and are ignored if it isn't the current question (a late response from a previous question).
  - `quiz/use-quiz-session.ts`: API calls (open question → hint → answer), answer pacing, the speed-mode deadline timer, retries, and navigation. It opens each question in `start`/`next` (event-driven, not an effect). `select`, `next`, and friends take current state through their `useCallback` dependencies, and only the `onFeedback` callback is read through `useLatest`. A synchronous `inFlight` ref (shared by answers and hints) guards against double taps that land before a re-render.
  - Options stay disabled until the server confirms the question is open (`opened`), because that's when the server starts timing.
  - `use-sound-preference.ts` and `use-option-hotkeys.ts`.
- **React rules beyond the default lint:** `eslint-config-next` 15 pins `eslint-plugin-react-hooks` 5.2, which has no `refs` or `set-state-in-effect` rules. v7 is installed separately under the npm alias `eslint-plugin-react-hooks-v7`, with its own config file, so it doesn't collide with Next's plugin of the same name. `npm run lint` (through `lint:hooks`) enforces it.
  - Never read or write `ref.current` during render. For "latest callback" refs, use `useLatest` (`src/lib/use-latest.ts`, updated in `useLayoutEffect`); swap it for `useEffectEvent` once on React 19.2+.
  - Callbacks that need current state take it via `useCallback` dependencies, not a mirrored state ref.
  - Don't `setState` synchronously in an effect to sync with external storage. Use `useSyncExternalStore` with a server snapshot, as `use-sound-preference.ts` does.
  - `npm run lint` fails on these violations through `lint:hooks`; this was verified with a deliberately violating file.
  - After the Next 16 upgrade the default lint includes these rules. Delete `eslint.hooks.config.mjs`, the `lint:hooks` script, and the `eslint-plugin-react-hooks-v7` alias then, and set `lint` back to `eslint`.
- **Quiz session:** the session is created in an effect with a `useRef` guard, so StrictMode's double effect doesn't create two sessions. A page refresh starts a new session, because there's no API to resume one.
- **URLs:** build them with `quizHref({ mode, categorySlug })` and `leaderboardHref({ mode, categorySlug, period, … })` in `src/lib/routes.ts` (`/quiz?mode=all|speed`, `/quiz?category=<slug>`), and use `RECORDS_HREF` for `/records`. Leaderboard `highlight=<rank>` marks the row that was just submitted; the submit rank is all-time, so the page ignores `highlight` on the weekly and daily boards. `routes.ts` also has the client-safe `QuizMode` and `LeaderboardPeriod` types and `LEADERBOARD_PERIODS`.
- **Leaderboard periods:** `period=all|weekly|daily` (default `all`). `periodStart()` in `src/lib/leaderboard-period.ts` cuts on the Korean calendar (UTC+9, no DST): today 00:00 KST, or this week's Monday 00:00 KST. The boards re-rank from 1 inside the period. `getLeaderboard(query, now)` takes an injectable `now`.
- **Local history (내 기록):** `LocalDataManager` in `src/lib/data-manager.ts` keeps the last `MAX_GAME_RECORDS` (100) finished games and cumulative stats (per mode; per category: correct/total across all modes, games and best score in category mode only) in localStorage under `trivia:history`. Stats keep counting after old games drop out of the list.
  - It's display-only. The server never receives it, and the leaderboard never uses it.
  - `SaveLocalResult` records the result in an effect when a completed result page opens. `recordGame` dedupes by `sessionId`, so refreshes and StrictMode's double effect count once. A session that has already dropped out of the 100 could be counted again; that's an accepted limit.
  - Treat the stored value as untrusted: `parseHistory` validates every field, skips bad or duplicate games, and rebuilds the stats from the remaining games if the stored stats are invalid. Category stats are an array, not an object keyed by name, so names like `__proto__` are safe.
  - The UI reads it through `useLocalHistory()` (`src/lib/use-local-history.ts`, `useSyncExternalStore`, server snapshot `null` meaning "not loaded yet"). Inject the storage and clock into `LocalDataManager` in tests.
- **Speed timer:** `src/components/Countdown.tsx` only displays the time; it reads the clock in effects, never during render. The timeout itself is the deadline effect in `use-quiz-session.ts`, which sends `selectedIndex: null`.
- **Styling:** Tailwind v4.
  - Theme tokens (`bg-surface`, `text-muted`, `border-border`, …) and the `shake`, `pop`, and `rise` animations live in `src/app/globals.css`. Use the animations only with the `motion-safe:` prefix.
  - Shared button classes are in `src/components/button-styles.ts`.
  - Dark mode follows `prefers-color-scheme`, so pair each color with a `dark:` variant.
  - The font is the system Korean stack; there's no web font.
- **Sound:** effects are synthesized with Web Audio in `src/lib/sound.ts`. There are no audio files. The mute preference is stored in `localStorage` under `trivia:sound`; local history uses `trivia:history`.
- **React keys:** sibling elements must never share a `key`. A shared key between `QuestionCard` and `FeedbackPanel` once left stale question cards in the production DOM.

## Security measures (keep these intact)

- **Request body limit:** `readJson()` in `src/lib/api.ts` caps request bodies at 4KB (`MAX_JSON_BODY_BYTES`) and returns 413 `PAYLOAD_TOO_LARGE`, even when there's no `Content-Length`. Always read request bodies through `readJson`, never `request.json()`.
- **Nicknames** (`usernameSchema` in `validation.ts`):
  - NFC-normalize, then trim, then count code points.
  - Reject `\p{Cc}`/`\p{Cf}` and blank-looking characters (Hangul fillers U+115F/U+1160/U+3164/U+FFA0, Braille blank U+2800). The one exception is an emoji ZWJ.
  - `trim()` also strips a leading or trailing BOM, so those are cleaned rather than rejected.
- **Security headers:**
  - `next.config.ts` exports `securityHeaders(isDev)`, which sets the CSP, `X-Frame-Options: DENY`, `nosniff`, and `Referrer-Policy: same-origin` (keeping `/result/<sessionId>` URLs from leaking through Referer). It also sets `poweredByHeader: false`.
  - The production CSP needs `'unsafe-inline'` for App Router hydration. Only `next dev` adds `'unsafe-eval'` and `ws:`.
  - If you add an external resource (fonts, analytics, images), you must extend the CSP. `tests/e2e/security.spec.ts` fails on any CSP violation during a real quiz flow.
- **Compose ports:** they bind to `127.0.0.1` only. Don't change them to `0.0.0.0`, because the DB uses the dev password `trivia`. Use `APP_HOST=0.0.0.0` only to expose the app for testing on other devices. `DATABASE_URL` uses `127.0.0.1`, not `localhost`, because `localhost` may resolve to `::1`, where nothing listens.
- **Rate limiting** (`src/lib/rate-limit.ts`):
  - Per-IP fixed-window counters live in the Postgres `rate_limits` table, so all replicas share them. Don't move them to memory.
  - Each check is one atomic `INSERT … ON CONFLICT … RETURNING`.
  - Every POST route (sessions, views, hints, answers, submit) calls `enforceRateLimit(request, rule)` **before** `readJson`, so invalid requests count too. Over-limit requests get 429 `TOO_MANY_REQUESTS` with `Retry-After`. Limits live in `RATE_LIMITS` and are deliberately generous for shared school/NAT IPs.
  - The client IP is the X-Forwarded-For entry `TRUSTED_PROXY_HOPS` from the **right**. ACA must set it to 1; compose sets 0.
  - Never read the leftmost entry, which is client-controlled. Next only fills XFF from the socket address when the header is absent.
- **Answer pacing:**
  - `submitAnswer` locks the session row (`SELECT … FOR UPDATE`) and rejects an answer that comes less than `MIN_ANSWER_INTERVAL_MS` (in `limits.ts`, shared with the client) after the previous answer or the session start.
  - `QuizRunner` sleeps out the remainder before sending, so real players never see the error.
  - `startedAt`, `viewedAt`, `answeredAt`, and `scores.createdAt` are written from the app clock, not DB defaults. Keep it that way, because the interval, TTL, time-bonus, speed-limit, and leaderboard-period checks compare JS times.
- **Server-side timing:** the time bonus and the speed-mode limit use `elapsed_ms` = answer arrival − `session_question_views.viewed_at`, never a client-reported time. Questions can only be opened in order (409 otherwise) and only opened questions can be answered (409), so answers are always in question order. A speed answer later than `SPEED_TIME_LIMIT_MS` + `SPEED_DEADLINE_GRACE_MS` (2s for network latency) is stored as `timed_out`, wrong even if correct.
- **Expiry and cleanup:**
  - Unscored sessions expire after `SESSION_TTL_MS` (24h); answer and submit on an expired session return 404.
  - `maybeRunMaintenance()` in `src/lib/maintenance.ts` is called from session creation. Once an hour per instance, it deletes expired unscored sessions (`cleanupExpiredSessions`) and old counters (`pruneRateLimits`, cut off at the longest window in `RATE_LIMITS`).
  - The runner is built with `createMaintenanceRunner()` so tests can make an isolated instance.
- **Known limits:**
  - Answer harvesting can't be fully prevented (wrong answers reveal the correct one, per PRD §2.2). The limits above only slow it to human speed. Session creation returns every question up front, so a script can also pre-read them and earn time bonuses.
  - Multi-IP attacks would need a CAPTCHA or login.
  - The Prisma CLI's deepmerge-ts and Next's bundled postcss have audit advisories, but neither is reachable with untrusted input. Fixing them needs the Prisma 7 / Next 16 majors.

## Resilience rules (timeouts, retries, idempotency)

- **DB timeouts:** `src/lib/prisma.ts` adds `connect_timeout=5`, `pool_timeout=10`, and `socket_timeout=10` to `DATABASE_URL` unless they're already set. Prisma's default query wait is unlimited, so without these a frozen DB hangs requests forever. Create the client only through this module.
- **Outage → 503:** `handle()` in `api.ts` maps transient Prisma errors (`isTransientDatabaseError` in `db-errors.ts`: P1001/P1002/P1008/P1017/P2024/P2028/P2034, init failures) to 503 `SERVICE_UNAVAILABLE` + `Retry-After: 5`. Everything else unexpected is a logged 500. Never let an exception escape a route handler.
- **Body reading:** `readJson` turns client aborts into 400 and bodies that don't arrive within 10s (`BODY_READ_TIMEOUT_MS`) into 408 `REQUEST_TIMEOUT`.
- **Health:** `/api/health` wraps the DB check in `withTimeout(…, 3000)` from `src/lib/async.ts`. Route files may only export route fields, so keep constants like the timeout file-local.
- **Idempotency is a contract:**
  - `openQuestion` keeps the first `viewedAt` (an upsert with an empty update) and returns the remaining time and any hint already used.
  - `requestHint` returns the stored `hintRemoved` instead of drawing again.
  - `submitAnswer` replays the stored result when the same question gets the **same** `selectedIndex` (including `null` for a timeout). That check runs inside the locked transaction, before the "opened?" and 1s interval checks. A different index returns 409. The feedback (points, streak, running score) is recomputed from stored rows, so a replay matches the original.
  - `submitScore` returns `{ result, replayed }`. The same nickname replays the original rank (the route answers 200 instead of 201 via `WithStatus`); a different nickname returns 409.
  - The browser's automatic retries depend on this, so don't break it.
- **Browser calls:** go through `postJson` in `src/lib/http-client.ts`, never raw `fetch`. It applies a 10s timeout, shows Korean messages (`ApiError`, `errorMessage`), and retries network errors and 502/503/504 (honoring `Retry-After`, capped at 5s).
  - Pass `retries` **only** for idempotent calls (open question, hint, answers, score submit). Session creation uses no retries and relies on the user's [다시 시도].
  - 4xx responses are never retried.
- **Answer failures:** after a failure, the chosen option stays locked (`canSelect` in `quiz-state.ts`) and [다시 시도] resends the **same** index (`answerToRetry`; `null` if it was a timeout). The server may already have recorded it, so a different choice would hit 409 forever. A 404 (expired session) switches to the restart screen, and `start` resets all quiz state.
- **`error.tsx` retry:** it must call `router.refresh()` together with `reset()` inside `startTransition`. `reset()` alone re-renders the failed server payload and doesn't recover; this was verified by freezing the DB.
- **Fire-and-forget work:** attach a `.catch` before racing it, as in `maintenance.ts`, so a late failure isn't an unhandled rejection. Browser promises that may reject, such as `AudioContext.resume()`, must also be caught.
- **Entrypoint:** retries `migrate deploy` with 3s·n backoff up to `MIGRATE_MAX_ATTEMPTS` (default 5), then exits 1.
- **Outage drills:**
  - `docker compose stop db` should produce 503 + Retry-After.
  - `docker compose pause db` simulates a hung DB: health must answer 503 within about 3s and the API within about 5–10s. Always `unpause` afterwards.

## Tests

- `vitest.config.mts` loads `.env` and derives `TEST_DATABASE_URL` by appending `_test` to the DB name of `DATABASE_URL`. You can also set `TEST_DATABASE_URL` yourself. Workers get it as `DATABASE_URL`, so the `prisma` singleton points at the test DB.
- `tests/global-setup.ts` creates `trivia_test` if it's missing, runs `prisma migrate deploy`, truncates everything, and reseeds. It refuses any DB whose name doesn't end in `_test`.
- Integration tests import route handlers directly and call them with `NextRequest` objects and `{ params: Promise.resolve({ id }) }`. They truncate sessions, answers, scores, and `rate_limits` in `beforeEach`. Files run sequentially (`fileParallelism: false`) because they share one DB.
- **Coverage:** `npm run test:coverage` (v8, `src/**/*.ts`; UI `.tsx` is left to E2E). Line coverage is 100%. The ~10 uncovered branches are defensive paths: unique-violation races behind the session lock, the unreachable maintenance rethrow, and the production-only Prisma singleton branch.
- **Hook and browser tests:** add `// @vitest-environment jsdom` per file; the rest stay in `node`.
  - Vitest globals are off, so Testing Library does **not** auto-cleanup. Call `cleanup()` in `afterEach`.
  - For modules with module-level state (`use-sound-preference`, `sound.ts`), call `vi.resetModules()` and dynamically import the module **and** `@testing-library/react` together, so they share one React instance.
- **Gotcha:** a `vi.fn` that returns a rejected promise marks the rejection as handled (Vitest attaches a handler to record `settledResults`). When a test asserts "no unhandled rejection", return the rejection from a plain function, or the test can't fail. A mutation check caught this in `sound.test.ts`.
- **Edge-case policy:** new pure functions get tests for null and non-object input, empty arrays, numeric extremes (`NaN`, `Infinity`, beyond `MAX_SAFE_INTEGER` and Postgres int4), and boundaries such as exactly-at-limit and limit+1 (for body bytes, measure bytes, not characters). Look up externally supplied keys with a `Map` or `Object.hasOwn`, never a plain object index. `categoryIcon("constructor")` used to return a function.
- **Clock in integration tests:** they fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`), so Prisma's real timers keep working. The `answer()` helper opens the question, advances the clock by `MIN_ANSWER_INTERVAL_MS`, then answers (so correct answers earn the time bonus). Use `answerNow()` to test the "too fast" path, `postAnswerOnly()` to skip opening, and `advanceClock()` for TTL, rate-limit windows, and the time bonus/speed limit.
- **Deterministic scores in integration tests:** scores depend on question order (difficulty, combos), so `playSession` rewrites the session's `question_ids` to ascending id before answering. Expected values are derived by hand in comments (for example science 7/10 = 152 of 217).
- **Client identity in integration tests:** pass a client IP as the third argument to `request()`; it's sent as X-Forwarded-For. Requests without it share the `unknown` bucket.
- **E2E session budget:** all local E2E traffic shares one IP, and both browser projects together must stay under the session-creation limit (30 per 10 minutes). The suite uses 28. Don't add tests that create sessions casually: check a link's `href` instead of clicking through, or fold checks into an existing quiz flow.
- **E2E rate-limit project:** `tests/e2e/rate-limit.spec.ts` exhausts the shared session bucket, because all local E2E traffic comes from the Docker gateway IP. It runs in its own Playwright project after the others (`dependencies`) and is skipped when `E2E_BASE_URL` is set. Global setup and teardown clear `rate_limits` for local runs (`tests/e2e/local-db.ts`).

## Data and migrations

- CHECK constraints that Prisma can't express (`answer_index`/`selected_index` 0–3, `cardinality(options) = 4`, and "`category_id` is set iff `mode = 'CATEGORY'`" on `quiz_sessions` and `scores`) are hand-appended to `prisma/migrations/*_init/migration.sql`. The `questions` triggers (see below) are hand-appended to `*_protect_questions_referenced_by_sessions`. Prisma doesn't track either, so when you add a migration that touches these tables, generate it with `prisma migrate dev --create-only`, re-add or keep them by hand, then apply it. After changing migrations, verify on an **empty** DB.
- **Question integrity is enforced by the DB:** `quiz_sessions.question_ids` is an array, so it can't have a foreign key. Triggers on `questions` reject `DELETE`, or a change of `id`, while any session references the question (`question_ids @> ARRAY[id]`, served by a GIN index). Prisma reports the rejection as `P2003`, like a normal FK violation. Content updates are still allowed, so seed upserts work. To retire a question, its sessions must be gone first; finished, scored sessions are kept forever, so in practice questions are never deleted.
- **Score/result consistency:** `getResult` and `submitScore` must both compute through `summarizeSession()` in `quiz/sessions.ts`. The max score and total are always based on the session's `question_ids`; `sessionQuestionInfos` falls back to the `UNKNOWN_CATEGORY` bucket, so totals never shrink. Never compute score totals separately.
- Question content lives in `prisma/data/questions.json` in the PRD §4 shape, including `difficulty` (`easy`/`medium`/`hard`; the seed maps it to the `Difficulty` enum and rejects anything else). Keep each category at 3 easy · 4 medium · 3 hard so category max scores stay equal (217). `category` holds the Korean category name, and the seed maps it to the `categories` slug. The seed upserts questions by their JSON `id`, so keep ids stable. Questions referenced by sessions can't be deleted or renumbered (the triggers above, plus the `session_answers` FK). Then it resets the `questions` id sequence.
- `prisma/seed.mjs` must stay plain JS, because the runtime Docker image has no `tsx`. It validates the whole JSON before writing anything.
- Keep correct answers spread across positions 0–3. The sample set is about 10 at each position. Questions whose options are in numeric order keep that order.

## Key design decisions (PRD §6.3)

- **Server-side grading:** never send `answer_index` to the client before the player answers. Each answer is posted to `/api/sessions/:id/answers`, and the server computes the final score from `session_answers`. This keeps the leaderboard from being faked.
- **Scoring (`src/lib/scoring.ts`):** only correct answers score. Base = 10 × difficulty multiplier (EASY 1, MEDIUM 1.5, HARD 2), plus +3 if answered in under 10s, +2 if no hint was used, and a combo bonus on the 3rd/5th/10th consecutive correct answer (+2/+5/+10, once per streak; a wrong answer or timeout resets it). Streaks are counted in question order.
  - `maxScore` is the highest achievable score, computed by `calculateMaxScore` (a small DP over streak lengths), **not** the all-correct score: with many questions, missing one easy question to earn another 10-combo can score higher (all-questions mode in id order: 817 all-correct, 821 max).
  - Leaderboards are kept separate per mode (ALL / per category / SPEED). Ties go to the earlier `created_at`.
- **Categories:** stored in the `categories` table, not hardcoded.

## Product summary (from PRD.md)

The product is a trivia quiz game called **"지식와 도전"**. It targets ages 14+ and must work in mobile and desktop web browsers, so the layout needs to be responsive and mobile-first.

- **Questions:** 40 four-option, single-answer questions, split into 4 categories of 10: 한국사 (Korean history), 과학 (science), 지리 (geography), 일반상식 (general knowledge).
- **Modes:** 전체 도전 (all 40 questions), 카테고리별 (one category, 10 questions), and 스피드 퀴즈 (20 random questions, 15s per question; time-up counts as wrong).
- **50:50 hint:** once per question, removes two wrong options and forfeits that question's +2 no-hint bonus.
- **Feedback:** right/wrong is shown as soon as the player picks an answer (color change, optional sound). After a wrong answer, show the correct answer and its explanation. The player moves on with a [다음 문제] ("next question") button.
- **Progress indicator:** for example `한국사 3 / 10`.
- **Results screen:** final score with its breakdown (base, time, hint, combo), best streak, accuracy rate, number correct per category, timeouts in speed mode, plus a nickname entry to submit the score.
- **Leaderboard:** top-ranked scores (Top 10 or Top 50) with a retry button.
- **Flow:** Main screen ([게임 시작] start game / [순위 보기] view rankings / [카테고리 선택] choose category) → Quiz → Results → Leaderboard.

## Data shapes (from PRD.md)

Use these field names as written:

- **Question:** `id`, `category` (one of 한국사/과학/지리/일반상식), `difficulty` (easy/medium/hard), `question`, `options` (array of 4), `answer_index` (0–3), `explanation`
- **Score record:** `username`, `score`, `created_at`

## Planned extensions (keep in mind, don't build yet)

The PRD lists these as future work. Design the code so they can be added later (the timed speed mode and the 50:50 hint are already built):

- More hint items, such as a "chance" (찬스)
- More categories (대중문화 pop culture, IT, 세계사 world history), so don't hardcode the list of four categories

## 퀴즈 문제 교차 검증 가이드라인

1. 모든 문제 작성 시 확인 사항
   - 다른 해석 가능 시 조건 명시(예: 면적 기준, 2024년 기준)
2. 최상급 표현에 기준이 있는가?
   - '가장 큰', '최초의' 등 표현에 측정 기준 명시
3. 시간과 범위가 명확한가?
   - 변할 수 있는 정보는 시점 명시
   - 지리적, 분류적 범위 한정
4. 교차 검증했는가?
   - 의심스러운 정보는 2개 이상 출처 확인
   - 논란 있는 내용은 주류 학설 기준
