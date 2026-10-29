# G6 frontend acceptance — employee assignment and task dependencies

## Contract
Pinned backend source: `feat/g6-task-relations-api`, `dfd368cb0b424c1da423beb1b0666ed815b179fd`.
Additions to OpenAPI 1.1.0: GET project members (paged, authenticated) and
optional `depends_on: string[]` in task metadata PATCH. The PATCH returns HTTP
201 **PlanVersion draft** (not a modified published Task). The published
task's dependency rows change only after exact-ID/hash human review, approval
and publication.

## UI
Existing Astra task drawer is unchanged structurally. Search by real member
name or email, choose an active human project member, or explicitly unassign.
The backend directory is fully paginated before an unknown member ID can be
treated as no longer listed; service/disabled identities are not selectable.
If the directory cannot load, no fictional names are shown and search is
disabled. Existing unknown/revoked assignee ID remains visible as an explicit
warning; no automatic replacement.

Dependencies are loaded from canonical GET
`/projects/{projectId}/tasks/{taskId}/dependencies` when the drawer opens;
the Kanban list no longer assumes the initial/source plan reflects the latest
published edges. The editable list includes only other tasks in this project;
a checked predecessor can be removed, and a new one selected by searching.
Self-dependencies and duplicates are blocked in the UI and in request
validation; the backend remains authoritative for cross-project and cycle
validation. Exact backend errors (including cycle and stale-version) appear
in German with request ID. When predecessor read fails, material editing is
disabled until a successful reload; status-only editing remains independent.

One metadata PATCH contains any modified task fields, selected assignee ID,
and the **complete selected depends_on set** only when dependencies changed;
otherwise the field is omitted to preserve backend closure. A lost response
does not trigger an automatic mutation retry. Immutable draft receipt opens
the exact returned plan ID in Review.

## Evidence
- `apps/frontend/src/test/g6-relations.test.tsx`: pagination (100+1),
  missing/disabled/service member states, Cyrillic search, dependency
  add/remove, G6 error codes.
- `apps/frontend/src/test/task-changes-api.test.ts` and
  `task-editing.test.tsx`: combined draft payload and contract boundaries.
- `apps/frontend/e2e-real/g6-relations-real.spec.ts`: real backend/PostgreSQL
  (isolated) member assignment, add/cycle rejection/remove, P1
  review/approval/publish, Kanban reload and membership removal.
- `.github/workflows/frontend-g6.yml`: ephemeral Postgres and pinned
  G6 backend, no AI/n8n/MCP credentials or worker. Fixtures exist **only** in
  its isolated database. No production/owner project data modified.

## Integration
Frontend delta is layered on `eda48be8c72067a1bddb32ef6da2a565f24cc64c`
in `feat/frontend`; integration owner should apply frontend-only files to
PR #4 after G6 Backend PR #5 is integrated. Never cherry-pick the G6 backend
reference into frontend; do not weaken CSRF or human approval. Preserve any
concurrent integration-specific changes. Local owner app `localhost:25174`
won't change until the integration owner builds the updated branch. No AI
calls were made in this workstream.

## Backend membership revocation limitation (verified in isolated G6)
The database intentionally rejects deletion of a member who is still assigned to a
published task (composite foreign key `tasks_project_id_assignee_id_fkey`).
The frontend does not bypass that constraint. The G6 browser acceptance
therefore verifies membership revocation in a separate project with no
assignment, and verifies that a **disabled assigned identity** remains labeled
accurately but cannot be selected as a new assignee. True removed-ID warning
is additionally unit-tested with a stale or unavailable directory entry.
For full removal, the organization must first reassign or unassign the task
via the immutable plan/approval/publication flow.
