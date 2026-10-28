# MCP tool ↔ canonical OpenAPI compatibility matrix

Source of truth: `feat/backend-core:packages/contracts/openapi.yaml`
(fetched 2026-10-28, commit `7faca55`).

Backend base URL (dev): `http://127.0.0.1:13081` (`apps/backend/`).

Service authentication: `Authorization: Bearer <service-bearer>` with required
service scopes. Mutations also require `Idempotency-Key` and (for cookie auth)
`X-CSRF-Token` — services use bearer only, no CSRF.

## Legend

- ✅ Service-callable with scope.
- 🧑 Human-only (`x-human-only: true` in the contract). The MCP server rejects
  these with code `human_only` when invoked by a service bearer.
- ⚠ Partial / contract shape differs from the original MCP shape.

## 16 MCP tools

| MCP tool                 | HTTP (method path)                                                                | operationId        | Scope                 | Service callable | Status |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------ | --------------------- | ---------------- | ------ |
| `list_projects`          | GET `/api/v1/projects`                                                            | `listProjects`     | `read`                | ✅               | OK     |
| `get_project`            | GET `/api/v1/projects/{projectId}`                                                | `getProject`       | `read`                | ✅               | OK     |
| `list_project_tasks`     | GET `/api/v1/projects/{projectId}/tasks`                                          | `listTasks`        | `read`                | ✅               | OK     |
| `get_task`               | GET `/api/v1/projects/{projectId}/tasks/{taskId}`                                 | `getTask`          | `read`                | ✅               | ⚠ needs projectId |
| `get_plan_version`       | GET `/api/v1/projects/{projectId}/plans/{planId}`                                 | `getPlan`          | `read`                | ✅               | ⚠ needs projectId |
| `get_project_progress`   | GET `/api/v1/projects/{projectId}/dashboard`                                      | `dashboard`        | `read`                | ✅               | ⚠ response shape differs — adapter maps |
| `get_approval_status`    | **derived** from GET `/api/v1/projects/{projectId}/plans/{planId}`                | (none)             | `read`                | ✅               | ⚠ synthesised from plan status |
| `list_activity_history`  | GET `/api/v1/projects/{projectId}/activity`                                       | `audit`            | `read`                | ✅               | OK     |
| `get_operation_status`   | GET `/api/v1/operations/{operationId}`                                            | `getOperation`     | `read`                | ✅               | OK     |
| `create_project`         | POST `/api/v1/projects`                                                           | `createProject`    | `projects:write`      | 🧑 **human-only** | **BLOCKED for service** |
| `create_plan_draft`      | POST `/api/v1/projects/{projectId}/plans`                                         | `createPlan`       | `plans:write`         | ✅               | OK     |
| `propose_plan_changes`   | POST `/api/v1/projects/{projectId}/change-proposals`                              | `proposeChanges`   | `plans:write`         | ✅               | OK     |
| `request_plan_approval`  | POST `/api/v1/projects/{projectId}/plans/{planId}/request-approval`               | `requestApproval`  | `plans:write`         | ✅               | OK     |
| `publish_approved_plan`  | POST `/api/v1/projects/{projectId}/plans/{planId}/publish`                        | `publishPlan`      | `plans:publish`       | ✅               | ⚠ requires prior human `decidePlan` approval; backend enforces |
| `update_task_status`     | PATCH `/api/v1/projects/{projectId}/tasks/{taskId}/status`                        | `taskStatus`       | `tasks:write`         | 🧑 **human-only** | **BLOCKED for service** |
| `update_task`            | PATCH `/api/v1/projects/{projectId}/tasks/{taskId}`                               | `taskMetadata`     | `plans:write`         | ✅               | ⚠ **returns a new draft PlanVersion** (201) that must be reviewed/approved/published; it is NOT a direct edit |

## Additional operations surfaced via the backend (not in v1 MCP tool set)

| HTTP (method path)                                                               | operationId         | Scope                                | Notes |
| -------------------------------------------------------------------------------- | ------------------- | ------------------------------------ | ----- |
| GET `/api/v1/projects/{projectId}/plans`                                         | `listPlans`         | `read`                               | Useful for `get_approval_status` fallback / listing. |
| GET `/api/v1/projects/{projectId}/tasks/{taskId}/dependencies`                   | `dependencies`      | `read`                               | Dependency graph for a task. |
| POST `/api/v1/projects/{projectId}/plans/{planId}/submit-review`                 | `submitReview`      | `plans:write`                        | Submits plan for review (prior step before `requestApproval`). |
| POST `/api/v1/projects/{projectId}/plans/{planId}/approvals`                     | `decidePlan`        | `approvals:write`                    | 🧑 Human-only decision endpoint — the actual approval. |
| GET `/api/v1/projects/{projectId}/operations`                                    | `listOperations`    | `read`                               | Operation audit. |
| POST `/api/v1/projects/{projectId}/agent/planning-requests`                      | `planningRequest`   | `operations:write`                   | Backend-driven agent planning (202 OperationJob). |
| POST `/api/v1/operations/{operationId}/result`                                   | `operationResult`   | `operations:write` + `plans:write`   | **Service-only.** Callback for async agent results. |
| POST `/api/v1/projects/{projectId}/conversations`                                | `conversation`      | `operations:write`                   | Correlate external chat session to a project. |

Follow-up work on this branch:

- Add `submit_review` and `list_plans` tools (both service-callable, read / plans:write).
- Add `request_agent_plan` (planningRequest), `store_agent_result` (operationResult, service-only), `correlate_conversation` (conversation).
- Remove or re-label `create_project`, `update_task_status` as `human_only` wrapper tools that return a policy error with a human remediation hint.
- Replace `update_task` semantics to make the proposal shape explicit (it is a `taskMetadata` draft, not an in-place edit).
- Derive `get_approval_status` from the plan's current state + the audit log, since no direct operationId exists.

## Error envelope mapping

Contract uses `{error:{code,message,request_id}}` with codes documented in
`feat/backend-core:docs/backend/integration.md`. The MCP adapter translates
them 1:1 to the existing MCP typed errors:

| HTTP | Contract code family                | MCP code                                    |
| ---- | ----------------------------------- | ------------------------------------------- |
| 400  | `validation_error`                  | `validation_error`                          |
| 401  | `unauthenticated`                   | `unauthorized`                              |
| 403  | `forbidden` / CSRF                  | `forbidden` (or `human_only` from adapter)  |
| 404  | `not_found`                         | `not_found`                                 |
| 409  | state / version / idempotency       | `conflict` / `stale_version` / `idempotency_conflict` |
| 413  | payload too large                   | `validation_error`                          |
| 415  | unsupported media type              | `validation_error`                          |
| 429  | rate limited                        | `rate_limited`                              |
| 500  | internal                            | `internal_error`                            |
| 503  | unavailable                         | `backend_unavailable`                       |

`request_id` from the backend is attached to the MCP log as
`backendRequestId` for cross-service tracing.
