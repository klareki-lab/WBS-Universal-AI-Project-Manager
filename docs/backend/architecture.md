# Backend architecture

Fastify HTTP handlers validate Zod input, authenticate users/services and enforce project membership. Domain functions implement immutable plans, approvals, publication and task state transitions. PostgreSQL is the source of truth. The automation worker calls an isolated HTTP adapter; domain code makes no model calls.

## Data and access

`users` distinguishes humans from scoped service identities. Humans have password hashes, services have hashed tokens and expiration. `sessions` holds hashed session/CSRF tokens. `projects` has stable UUID, human owner, lifecycle status and optimistic version. `project_members` supports owner/editor/viewer roles and multiple independent projects. Ownership/member administration is deliberately limited to the trusted provisioning/database operator until a separately reviewed membership API is needed.

`phases`, `tasks`, and `task_dependencies` represent published execution state. Composite foreign keys reject cross-project phases, assignees, plans and dependencies. `plan_versions` stores complete immutable JSON snapshots and deterministic SHA-256 hashes, while `plan_task_drafts` makes individual proposal tasks queryable. `change_proposals` explains material changes. `approvals` binds a human ID, exact plan ID, content hash, decision and timestamp. `operation_jobs`, `activity_events`, `conversation_sessions`, and `idempotency_records` provide durable orchestration, auditing, correlations, and safe HTTP retry.

## Plan lifecycle

1. An authenticated human or project-scoped service submits a structured snapshot, including the current `base_project_version`. Task keys and phase keys are unique. Each task references a declared phase; all dependency keys exist and form an acyclic graph.
2. The backend saves a new numbered immutable draft and computes its hash. There is no edit-in-place API. Approved or published content cannot be changed, including through SQL UPDATE or DELETE guarded by triggers.
3. `submit-review` moves draft→in_review. `request-approval` also accepts an already in_review version and records another request event. Neither call records authorization to publish.
4. A human owner/editor approves or rejects the exact saved hash. Service identities fail even if someone grants an `approvals:write` scope directly in the database. PostgreSQL also validates human identity, membership, state and hash on approval insertion.
5. Publish locks the project and plan. It checks snapshot hash, human approval, project status and base version. It creates/updates phases, tasks and dependency edges; validates the full resulting graph and dependencies of active/completed tasks; supersedes the previous published plan; advances the project version; writes a succeeded operation and activity event. All steps commit together.
6. Repeated publication returns the same durable operation, including with a different idempotency key. Publishing a previously superseded version returns its original successful operation and does not reactivate it.

Plan snapshots describe additions and updates, not deletion. A new task omits `task_id` and `expected_version`; an update must include both. Omitted existing tasks remain unchanged. Declared task dependencies replace the predecessors on those tasks only. A full graph check includes retained tasks, in linear time. Removing work uses the human task status `cancelled`; there is no delete endpoint. Phase keys remain stable within a project. A metadata PATCH builds a proposal containing current task metadata/edges and returns **PlanVersion**, not Task. Publication retains existing task status and increments versions for updated task rows.

## Concurrency and retries

Domain writes require an actor-scoped Idempotency-Key. A PostgreSQL advisory transaction lock serializes duplicate keys. A canonical hash binds key to method, URL and validated payload. Successful responses and status codes are stored in the same transaction as domain changes. Reusing a key with a changed request returns 409. Authorization runs again before replaying a stored response. Failed transactions store no successful record, so the same command can safely retry.

Project row locks serialize material writes and status changes; task and project optimistic versions detect competing edits. Any task status change advances the project version, so an approval based on an older project state cannot silently overwrite new work. Plan creation takes a project lock to allocate unique version numbers. Approval and publication take locks in project→plan order. PostgreSQL constraints remain the final cross-project integrity boundary.

A publication failure rolls back all effects and returns an error with request ID; no partial published state or success operation remains. The client can retry the same key. Long-running planning is different: the request returns 202 immediately with an operation UUID. Worker claims use SKIP LOCKED and 60-second leases. Expired leases are reclaimable after restart. Delivery attempts are bounded at three; failures back off 10×attempt seconds, then become failed. The same operation UUID is sent as the upstream idempotency key on every attempt. A worker accepts either a final result or 202 with a later scoped service callback. Duplicate terminal callbacks with the same HTTP key replay the saved result; a new key returns a terminal-state conflict.

There is no distributed exactly-once promise for n8n execution. Its workflow must deduplicate operation IDs. The backend does guarantee a single committed result/draft for each operation. Terminal errors are sanitized. Process-crash exhausted leases become explicit failures. No automatic retry of human approvals or unbounded network retries occurs.

## Task state policy

Allowed transitions:

| From | To |
|---|---|
| todo | in_progress, blocked, cancelled |
| in_progress | todo, blocked, done, cancelled |
| blocked | todo, in_progress, cancelled |
| done | in_progress |
| cancelled | todo |

Same-state requests are no-ops after checking the expected version. Starting/completing requires all predecessors done. Reopening done work is prohibited while a dependent is in_progress/done. Archived projects reject plan creation, planning requests, publication, and task state updates. Material task changes require fresh immutable proposal/approval/publication. A project may be unarchived by a human with a version-checked metadata update.

## Operational scope

Migrations are append-only after publication; this initial migration is transactional and idempotently tracked. Schema owner credentials belong only to the backend/operator, never MCP. This local implementation uses a single backend database role; split migrator/runtime roles and external log/backup retention are deployment hardening work. DB superusers can always bypass triggers, so the database owner is a trusted operator, not an adversarial principal.

## v1.1.0 remediation changes

Migrations 003/004 add project context to idempotency records, immutable request/context provenance to operation jobs, origin_operation_id to saved plans, and append-only approval revocations. Legacy pending AI jobs are failed explicitly because the backend cannot infer their original immutable context. Completed history is retained.

Both callback and synchronous worker result application validate the original operation context, base version and current originating identity/membership/scopes. Preflight also prevents stale/unauthorized jobs from starting new adapter deliveries. Permanent context/auth conflicts fail the worker job without retrying; transient delivery/infrastructure errors retain bounded retry/lease behavior.

Pending approvals now require current eligible approvers and no recorded revocation. Disable, membership removal and viewer downgrade permanently revoke unconsumed approvals; explicit human revocation and history endpoints are available. This is a published conservative RC decision, not an inferred original product requirement; see remediation/APPROVAL_POLICY.md. The canonical API version is 1.1.0.

Pool/client background errors are handled and broken connections discarded. Original transaction errors survive rollback failure. No application mutation is automatically retried after an ambiguous connection loss; atomic idempotency records make exact-key client retries safe. The process stays alive through runtime database outages and reconnects on subsequent bounded requests; readiness returns 503. Startup migration failure exits and Compose permits three on-failure restarts. A future production supervisor/DB failover topology still needs its own operational design.
