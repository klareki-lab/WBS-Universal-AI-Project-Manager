# Backend Core engineering handover — 2026-10-28

**Overall: CONDITIONAL PASS. Backend foundation: PASS.** The complete local backend, database, security controls, contract and durable automation adapter are implemented and verified. End-to-end integration with the other workstreams remains conditional because no frontend/MCP client or live n8n workflow/credentials were supplied to this workstream. A real local HTTP adapter fixture verifies the automation boundary without touching existing n8n services.

Implementation commit: **49dc69af34ad8284ddb9ae1041236ec4b395c33a**. Branch: `feat/backend-core`. Repository: `klareki-lab/WBS-Universal-AI-Project-Manager`. Worktree: `/Users/admin/Projects/uapm-codex`. The subsequent handover commit contains documentation only. The PR head is the final deliverable; no merge into main or release was performed.

## Delivered

| Area | Result |
|---|---|
| Database | PASS — 14 canonical domain entities, authentication sessions, membership, 2 transactional migrations, composite cross-project foreign keys and publication uniqueness index |
| Authentication | PASS — administrative user provisioning, scrypt passwords, expiring server-side sessions, logout/current-user/session validation |
| Authorization/security | PASS — project isolation, owner/editor/viewer roles, scoped and expiring service identities, human-only approval, CSRF/origin/rate/payload protections and headers |
| Projects/tasks | PASS — create/list/get/update/dashboard, filtering/search/pagination, dependency reads, optimistic status transitions and approved metadata change proposals |
| Planning | PASS — immutable drafts/versions, review, exact-hash human approval/rejection, atomic idempotent publication and supersession |
| Orchestration | PASS — durable operation UUIDs, bounded retries, restart-reclaimable leases, sanitized failures, audit history, conversation correlations, n8n adapter and scoped callbacks |
| Contracts | PASS — OpenAPI 3.1 (26 paths), 39 standalone JSON Schemas, generated TypeScript types, request/response fixtures and MCP mapping |
| Containers | PASS — isolated uapm-dev backend/postgres, own network/volume, loopback ports, health/readiness, nonroot read-only backend |
| Documentation | PASS — installation, environment examples, architecture, security, integration/Compose notes and evidence |
| Live frontend/MCP/n8n integration | CONDITIONAL — connect callers/workflow and provide scoped HTTP secrets; no domain implementation blocker |

## Verification evidence

- **29/29 automated tests passed**, 4 test files, 0 failures. Of these, 24 integration cases use a real Fastify HTTP listener and the isolated PostgreSQL `uapm_test` database. The other cases cover OpenAPI/schema synchronization, real HTTP adapter behavior and CLI security validation. Full machine-readable results: [evidence-tests.json](evidence-tests.json).
- Tests include login/expiration/logout/CSRF, manipulated project and nested resource IDs, viewer access, project creation/isolation, 12-task drafts, SQL snapshot/approval/audit immutability, hash mismatches, human-only approval/rejection, concurrent and duplicate publish, injected mid-publication failure with rollback/retry, dependency cycles, safe status transitions, optimistic concurrency, invalid dates/assignees/payloads, service scope/expiry restrictions, operation callbacks, interrupted/exhausted leases, bounded failure states, archived projects, rate limits and tracing.
- **Docker build and startup passed**, with both containers healthy. Verified runtime versions: Node.js **24.22.1** in the container (24.15.0 on host) and PostgreSQL **17.11**. Image used for smoke verification: `sha256:0fae520580da8dd921cd3e02ebd1f366c50e3f4a9156aa08f32b740ff32dc218`.
- **TypeScript typecheck/build, contract generation/validation, formatting and npm audit passed**. npm audit reported **0 vulnerabilities** for the locked installation. Docker production dependency pruning also reported 0 vulnerabilities.
- **Real container API smoke: PASS** at `http://127.0.0.1:13081`. The run provisioned a user, authenticated, created two projects, stored/retrieved a plan, requested review, approved the saved hash, published twice with one idempotency key, advanced a task to done, read dashboard/activity, and checked SQL state. See [evidence-smoke.json](evidence-smoke.json) for HTTP statuses, request IDs and exact database counts.
- Resulting database counts: **12 tasks, 3 phases, 11 dependencies, 1 approval, 1 publish operation**; the independent second project has **0 tasks**. Dashboard reports **11 todo, 1 done, 8% progress**. Duplicate publication returned the same durable operation UUID.
- Confirmed backend UID **1000**, no `.env` in the runtime image, and local secret absent from all staged files. All implementation files are within assigned paths. Existing production containers were inventoried only and never modified.

The fault tests inject a database failure and expired lease state; they verify transaction rollback and restart semantics without killing a production or unrelated process. n8n tests use a local HTTP fixture, not a claimed live workflow execution.

## Run and integration entry points

[Installation and administrative CLI](README.md), [architecture](architecture.md), [security](security.md), [frontend/MCP/n8n contract](integration.md), and [OpenAPI](../../packages/contracts/openapi.yaml).

The local development stack is left running on **127.0.0.1:13081** and **127.0.0.1:15439**, using only `uapm-dev` resources. Ignored local environment files hold generated development database credentials. No credentials were committed or sent to other agents. The demonstration user uses an unprinted random password; provision a reusable human identity through the documented CLI.

Astra should integrate cookie authentication/CSRF, version fields, exact-version approval, and proposal-returning task metadata PATCH. Claude Code should use the documented MCP mapping and a project-scoped service token, configure a dedicated workflow endpoint, validate its outbound adapter token, deduplicate operation IDs, and return the canonical structured result. Service approval is deliberately impossible. This backend PR is the coordination artifact; other agent branches were not modified.

## Limits and remaining integration work

1. **Live automation:** N8N_ENDPOINT/N8N_TOKEN are unset locally. Configure a dedicated internal workflow and provision its callback token. Until then queued planning jobs remain visible as queued. Backend/domain calls do not invoke models directly.
2. **Async lease:** workflows should finish/callback within 60 seconds to avoid redelivery and deduplicate by operation_id. Three deliveries maximum; no heartbeat endpoint exists in v1. The backend guarantees one committed result per operation, not exactly-once external workflow execution.
3. **Product scope:** membership/owner administration, password reset, public registration and service token rotation UI are not HTTP endpoints in this foundation. Trusted CLI provisioning and disabling are implemented. The data model supports multiple human and service members.
4. **Explicit bounds:** 1 MiB bodies, 500 tasks/50 phases per snapshot, 100 rows/page. Metadata PATCH currently builds a current-project proposal; for projects exceeding a snapshot limit, callers should submit focused change proposals via the planning API. Projects themselves are not limited to one snapshot's number of tasks. Snapshot omissions retain existing tasks; cancellation uses the task state API. No destructive task deletion exists.
5. **Deployment:** local Compose uses the project's own PostgreSQL bootstrap/schema-owner role for app/migrations. Split least-privilege runtime/migrator roles, TLS ingress, backups, shared rate limiting and external operational retention before a production release. No VPS/cloud deployment, production database access, or paid resources were used.
6. **Retention:** sessions expire but are not periodically purged; idempotency records persist to preserve retry guarantees. Establish retention/maintenance policy with operational requirements.

Changed files are listed in [changed-files.txt](changed-files.txt). Executable code is in `apps/backend/`; contract artifacts are in `packages/contracts/`; independently mergeable Compose/Docker changes are in `infra/backend/`; handover and coordination are in `docs/backend/`.
