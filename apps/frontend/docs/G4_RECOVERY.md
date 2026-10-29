# G4 recovery after interrupted assistant session

## Recovered state (29 October 2026)

Remote `feat/frontend` and Draft PR #2 were both at
`319760151e63270ab30138b1ced77ac0e7ebdb72`. PR #2 still targeted `main`;
its description had not yet been updated from the earlier build/security gate.
PR #4 was independently at `d22b0c35cae4a5e68fc76e51fe50e144735911f7`.
No branch reset, force update, merge or integration-branch change is needed.

The user Mac path `/Users/admin/Projects/uapm-frontend-qa` is not mounted in
this recovery environment. No prior Git worktree was found in its accessible
runtime data directories. This does NOT establish that the user's Mac is
clean: uncommitted files there are unverified and must be preserved. Recovery
uses current GitHub objects and compare-and-swap updates of `feat/frontend`.

## Work already implemented: do not repeat

See [G4_REMEDIATION.md](G4_REMEDIATION.md) for the existing GET coordinator,
5-second/1-second read reuse, abort handling, bounded Retry-After recovery,
mode-specific task controls/activity, exact task versions, durable explicit
write replay and unchanged multilingual project input. All of that is already
committed. The concurrent integration-owned planning-failure guidance is also
retained. This recovery does not redesign or replace those implementations.

Both exact-SHA runs completed successfully before recovery:

- [Frontend QA 40847024685](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/actions/runs/40847024685):
  clean install, typecheck, **64/64 unit tests**, **10/10 smoke checks**,
  demo/live builds, **17/17 Chromium tests**, full/runtime audits **0 findings**.
- [Real G3 backend 40847024738](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/actions/runs/40847024738):
  **6/6 real browser scenarios**, UTF-8 byte equality for three project rows,
  real exact-hash approval/publication, task conflict and status update,
  audit, lost-response explicit replay creating one project, and real 429
  recovery from the unchanged limiter. SQL confirms zero planning jobs.

Artifact SHA-256 values verified while recovering the reports:

- QA: `a50f5a0ab2abd71736771ec7a3cca6ccda9608494f17d392e3ff0f08080b6c5d`
- Real backend: `3bc429ac4f468239583d74c82bc482ac3b876a5793e992c4777ab7e366a72561`

These are recovered results for `3197601`, not claims of a rerun or tests on
the Mac. The existing read-only CI gates validate the recovery commit; PR #2
records their final SHA, run URLs and actual totals after completion.

## One residual defect found and fixed

The real-backend 429 screenshot still showed `Noch keine Demo-Aktionen` in
the live Activity empty state. `Activity.tsx` used `de.activity.noEvents`
unconditionally, despite the existing `g4.eventsEmpty` translation. It also
rendered empty-history/empty-jobs placeholders before a response was known.

The bounded recovery patch changes only that presentation behavior:

- Live empty history uses `g4.eventsEmpty`; explicit demo mode keeps demo copy.
- Empty-event and empty-job claims require an actual loaded result.
- Previously loaded records remain visible during a failed refresh.
- Existing layout, request coordination, auth, routes, idempotency and server
  policies are unchanged. Six component regressions cover these states.

## Remaining acceptance and integration work

The G4 integration owner must apply frontend-only changes to PR #4 and verify
the Product Owner's existing `localhost:25174` environment. Same-origin API
routing is required for reading Retry-After with the unchanged G3 CORS policy;
without readable retry metadata the implemented recovery is deliberately manual.
Follow G4_REMEDIATION.md: do not cherry-pick the baseline-reconciliation commit
or copy entire files over concurrent integration changes. Preserve both read
coordination and the integration owner's planning-failure guidance.

No new paid AI/provider request is authorized or made. Multilingual input and
PostgreSQL storage are verified; AI output-language compliance remains an
unverified product enhancement, not a guarantee from these tests. Large-list
pagination and cross-tab coordination remain outside this bounded workstream.

PR #2 stays Draft with its existing target. No edits to main, backend/MCP
worktrees, production, the OpenAPI 1.1.0 contract or Codex's integration branch.
