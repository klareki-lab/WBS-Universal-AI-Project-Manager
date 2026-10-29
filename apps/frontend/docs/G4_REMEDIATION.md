# G4 - Frontend UX and live-mode clarity

## Scope and provenance

Canonical baseline: accepted G3 `0ba4899a3130a8663a719f4856d4b463e5b976a3`.
The frontend subtree was reconciled byte-for-byte into `feat/frontend` in
`c526a35d12447d8cdd22b35f80dff50c0b06db86`. This was not a merge of backend,
MCP, automation, infrastructure, or contracts into the frontend branch.
G4 code starts at `fb115d7345571b504abf22cbcd64bc491be3d239`.
PR #2 stays Draft and targets `main`; PR #4 and its branch are not modified.
During G4, PR #4 advanced to `d22b0c35cae4a5e68fc76e51fe50e144735911f7`.
Its frontend planning-failure guidance and regression test are retained here:
budget/concurrency failures explain recovery and replace the pending notice.
No backend/AI-budget-mode changes from that parallel commit are imported.

Only frontend source and dedicated frontend CI are changed. OpenAPI 1.1.0,
human approval/revocation, exact plan hashes, the rate limiter and session
policy remain owned by the unchanged G3 backend. No paid AI calls are needed
or permitted for this verification.

## G4-01: root cause and remedy

Previously, Dashboard fanned out tasks and activity across every project;
activity loading fetched the project list again. Reading tasks also loaded
source plans even when Dashboard only needed task counts. Several route and
context effects issued the same GET concurrently; React StrictMode replay
could multiply reads. LivePlanWorkspace polled project, plans and operations
every five seconds even after jobs were terminal. A context loading/error
branch removed the entire Outlet. The session gate interpreted any bootstrap
failure as a login failure. These were independent frontend amplifiers of
an otherwise valid backend request limit.

`readCoordinator.ts` now implements tab-memory-only GET reuse (5 seconds,
1 second for operation reads, no completed auth caching), in-flight request
deduplication, at most two concurrent GETs and per-consumer AbortSignals.
Responses are copied before delivery; project URL and invalidation generation
are part of the key. The last cancelled consumer aborts the fetch or wait.
Writes and authentication changes invalidate successful read reuse. Errors
are not cached as data. No server authorization is replaced by this cache.

Dashboard no longer loads source plans solely to count tasks, and history is
scoped to the selected project. Navigation reuses the shared project list.
LivePlanWorkspace polls only while actual queued/running IDs exist: one
project-scoped operations GET per five-second cycle, no overlapping cycles,
no polling in a hidden tab. A terminal transition refreshes the saved plan.

For 429, the client uses only an exposed `Retry-After` header: integer seconds
or an HTTP date, accounting for the server Date header when present. It does
not parse/guess delays from error prose. GET retries are bounded to two
retries; unknown intervals or repeated throttling require an explicit retry.
A German banner shows the deadline/countdown and request ID. Layout, route,
selection and same-view successful data remain. Initial reload/bootstrapping
shows a branded recoverable wait, not a fabricated authenticated view.
Obsolete route reads are aborted and cannot populate another project.

Only GETs auto-retry. POST/PATCH, login and approvals are never automatically
replayed. Existing G3 sessionStorage idempotency-key recovery for identical
commands is preserved, including an explicit replay after a lost response
and browser reload. Task status writes use the version the user actually
reviewed, not a fresh version silently fetched to bypass a conflict.
401 requires login; 403 retains an explicit authorization/CSRF error; 409
requires state refresh and renewed review. None falls back to demo data.

## Important integration detail: Retry-After visibility

G3 CORS exposes `x-request-id` but not `Retry-After`. A cross-origin browser
cannot read that header even when it appears in DevTools. Do not guess a
wait period or weaken the backend rate limiter.

For isolated local integration, start Vite with a same-origin `/api` proxy:

```bash
# In the integration owner's frontend directory, using its existing API port.
VITE_DATA_MODE=live VITE_API_BASE_URL= \
UAPM_DEV_API_TARGET=http://127.0.0.1:23081 \
npm run dev -- --host localhost --port 25174
```

`23081` is an example: confirm the actual G3 backend listener first. The
frontend origin must match the backend's existing ALLOWED_ORIGIN; do not
change backend security settings just to make this command work. Existing
`.env.local` can also define these non-secret settings. Restart Vite after
changing mode/proxy configuration. `UAPM_DEV_API_TARGET` accepts only an
unauthenticated HTTP loopback origin. `changeOrigin` is false: the original
Origin, cookies and identity remain intact. The backend limiter stays active.
The real CI uses a new isolated backend at 13081 and frontend at 15175.

For a later deployed topology, the integration owner must provide an existing
same-origin API route or coordinate exposing Retry-After in CORS. This task
does not change any production proxy. Without readable retry metadata the
UI intentionally offers manual recovery rather than promising a countdown.

## G4-02: component inventory

| Area | Live behavior | Demo boundary |
| --- | --- | --- |
| Layout / session | Authenticated backend badge; cookie + CSRF bootstrap; recoverable read errors | Explicit demo notice only in mock mode |
| Dashboard | Actual tasks and selected-project history; cached reads | Demo examples only from explicit mock adapter |
| Create Project | Only canonical name and description are submitted unchanged | Demo templates/defaults remain demo-only |
| Task list / Kanban | Published task records, exact-version status PATCH, cancelled state | Direct creation remains disabled in live mode |
| Task detail panel | Backend badge, status-only save, displayed version, real error on conflict | Title/description/priority/date/assignee/dependencies are read-only in live mode; no local save toast |
| Planning / Review / Approval | Existing G3 LivePlanWorkspace and exact ID/hash/approval/revocation flow preserved | No second application and no demo approval state in live routes |
| Project Assistant | Stored planning-operation records; explicit action queues a backend operation | Read-only Q&A and demo proposal application disabled in live mode; an operation record is not AI output |
| Activity / Operations | Selected project's `/activity` and `/operations` records, real IDs and status | No global demo history in live mode; no misleading retry-execution button |
| Settings | PostgreSQL through authenticated backend; AI availability reported per operation | In-memory storage labels only for demo |

Material task changes are **not** direct status updates. The backend already
supports proposals/new immutable plan versions; the restricted panel guides
the user to planning/review rather than pretending to save arbitrary metadata.
This is not a request to add an unrestricted task-write endpoint.

## G4-03: multilingual content and AI boundary

The frontend forwards project name and description without trimming,
normalization, translation or ASCII filtering in live mode. Names use the
canonical 200-character input bound and descriptions 20,000; line breaks,
Cyrillic, Latin, punctuation, combining accents and surrounding spaces are
preserved. The system UI remains German. Project selection and task status
filters operate independently of content language. The existing canonical
`tasks?q=` search is verified separately; no unsupported project-search API
is invented.

Verification layers must not be conflated:
- Unit/controlled HTTP tests verify exact payload and UI behavior only.
- `e2e-real/g4-real.spec.ts` uses a running pinned G3 backend plus fresh
  PostgreSQL, performs browser create/reload, and compares canonical GETs.
- `scripts/g4-verify-db.mjs` independently reads those actual rows and
  checks string/UTF-8-byte equality and zero planning jobs.

Source inspection (no provider invocation):
`automation/n8n/ai-profile/G3AIWorkflow00001.json` forwards `input.prompt`
without language translation, subject to a 1,500-character adapter bound.
The Coordinator and Planner/Reviewer profiles interpolate the goal into
English instructions and require structured JSON; the Planner requires
ASCII temporary IDs, not ASCII project/task text. The MCP prompt schemas
also accept string goals. There is no canonical output-language field,
language validation, or guarantee of same-language AI output. A user's
language request can be included in a goal but compliance is **not verified**
here. An explicit output-language setting and multilingual provider tests are
a separate product enhancement requiring a new authorized call budget.

## Reproducible tests

```bash
cd apps/frontend
npm ci
npm run typecheck
npm test
npm run test:smoke
npm run build
VITE_DATA_MODE=live npm run build
npm audit
npm audit --omit=dev
npx playwright install chromium
npx playwright test
```

The existing frontend-qa workflow runs clean installation, all unit/smoke
checks, both builds, audits and desktop/mobile/browser fixtures. New G4 real
CI checks out G3 at the pinned SHA in a separate read-only reference clone,
starts an ephemeral Postgres service and backend with N8N_ENDPOINT empty,
creates only a synthetic test human, and runs:

```bash
npx playwright test --config playwright.g4-real.config.ts
node scripts/g4-verify-db.mjs
```

Real CI never provisions a provider key or starts an n8n/MCP worker. Browser
planning requests fail closed, and SQL evidence requires zero planning jobs.
Real-auth browser traces are disabled; artifacts contain synthetic content,
operation IDs, screenshots and verification reports, not passwords/cookies.
Reports and exact test totals for the final SHA are linked from PR #2.

## Integration owner: apply to PR #4

Do not cherry-pick the baseline-reconciliation commit: G3 already has that
frontend. Apply the G4 remediation commit(s), or generate a frontend-only
patch from the reconciled baseline to the final SHA:

```bash
git diff c526a35d12447d8cdd22b35f80dff50c0b06db86 <FINAL_FRONTEND_SHA> \
  -- apps/frontend > g4-frontend.patch
# In an approved integration worktree, after checking branch/status:
git apply --check g4-frontend.patch
git apply g4-frontend.patch
```

PR #4 has concurrent changes in `src/pages/LivePlanWorkspace.tsx` and
`src/test/live-planning-status.test.tsx`. Do not overwrite those paths using a
whole-directory copy. The G4 final versions combine the new read/polling flow
with the integration owner's failure guidance (centralized in `i18n/g4.ts`).
Resolve context conflicts against d22b0c3 by preserving both behaviors, then
run the strengthened planning-status regression and the full test suite.
Do not revert any backend, workflow budget, or usage-ledger changes.

The integration owner may separately copy `.github/workflows/frontend-g4.yml`
if desired. Its test backend remains pinned to accepted G3. No production
changes, merge, retargeting of PR #2, or changes to PR #4's branch are performed
by this workstream. Recheck the Product Owner's localhost:25174 with its
real same-origin API route before declaring owner-environment acceptance.

## Remaining limits

Existing collection APIs/adapter screens use the first 100 records; this
bounded G4 change does not implement portfolio-wide pagination or a new
aggregate dashboard endpoint. Large portfolios need a separate performance
scope. Cross-tab read coordination is not implemented. Material plan editing
retains the existing G3 MVP surface rather than a new full editor. AI output
language is not guaranteed and no new model run is claimed.
