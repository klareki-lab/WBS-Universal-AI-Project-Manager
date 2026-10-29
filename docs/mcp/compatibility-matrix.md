# MCP tool ↔ canonical OpenAPI compatibility matrix (G3)

Source of truth: `feat/backend-core:packages/contracts/openapi.yaml`
(fetched 2026-10-29, commit `7faca55`).

Backend base URL (dev): `http://127.0.0.1:13081` (`apps/backend/`).

Service authentication: `Authorization: Bearer <service-bearer>` with required
service scopes. Mutations also carry `Idempotency-Key` (8–200 chars of
`[A-Za-z0-9_.:-]`). Services never use CSRF — that is reserved for cookie
auth from the human frontend.

The MCP catalog is **16 canonical tools**. Tools preserved by name even when
backend policy makes them human-only; the HTTP adapter refuses those with
`human_only` **before** any network call so the policy cannot be bypassed by
a mis-scoped service token. Scoped tools now require both `projectId` and
the child identifier in their input schema, matching the backend path shape.

## Legend

- ✅ Service-callable with the listed scope.
- 🧑 Human-only (`x-human-only: true`). Adapter refuses locally with
  `human_only`. No network call issued.
- ⚠ Shape or semantics differ from a naive single-id tool and are explicitly
  encoded in the tool contract.

## 16 MCP tools

| MCP tool                 | Input                                                                                | HTTP (method path)                                                                | operationId        | Scope               | Service callable |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------ | ------------------- | ---------------- |
| `list_projects`          | `cursor?`, `limit?`, `status?`, `query?`                                             | GET `/api/v1/projects`                                                            | `listProjects`     | `read`              | ✅               |
| `get_project`            | `id`                                                                                 | GET `/api/v1/projects/{projectId}`                                                | `getProject`       | `read`              | ✅               |
| `list_project_tasks`     | `projectId`, pagination, `status?`, `priority?`, `phaseId?`                          | GET `/api/v1/projects/{projectId}/tasks`                                          | `listTasks`        | `read`              | ✅               |
| `get_task`               | `projectId`, `taskId`                                                                | GET `/api/v1/projects/{projectId}/tasks/{taskId}`                                 | `getTask`          | `read`              | ✅ ⚠ scoped      |
| `get_plan_version`       | `projectId`, `planVersionId`                                                         | GET `/api/v1/projects/{projectId}/plans/{planVersionId}`                          | `getPlan`          | `read`              | ✅ ⚠ scoped      |
| `get_project_progress`   | `projectId`                                                                          | GET `/api/v1/projects/{projectId}/dashboard`                                      | `dashboard`        | `read`              | ✅               |
| `get_approval_status`    | `projectId`, `planVersionId`                                                         | GET plan + GET audit (`activity`), audit cross-referenced                         | derived            | `read`              | ✅ ⚠ scoped, audit-correlated |
| `list_activity_history`  | `projectId`, pagination                                                              | GET `/api/v1/projects/{projectId}/activity`                                       | `audit`            | `read`              | ✅               |
| `get_operation_status`   | `operationId` (globally unique)                                                      | GET `/api/v1/operations/{operationId}`                                            | `getOperation`     | `read`              | ✅               |
| `create_project`         | `name`, `description?`, `domain?`, `tags?`, `idempotencyKey`                         | POST `/api/v1/projects`                                                           | `createProject`    | `projects:write`    | 🧑 refused locally |
| `create_plan_draft`      | `projectId`, `plan`, `idempotencyKey`                                                | POST `/api/v1/projects/{projectId}/plans`                                         | `createPlan`       | `plans:write`       | ✅               |
| `propose_plan_changes`   | `projectId`, `basePlanVersionId`, `plan`, `rationale?`, `idempotencyKey`             | POST `/api/v1/projects/{projectId}/change-proposals`                              | `proposeChanges`   | `plans:write`       | ✅               |
| `request_plan_approval`  | `projectId`, `planVersionId`, `note?`, `idempotencyKey`                              | POST `/plans/{planVersionId}/submit-review` for draft, else `/request-approval`   | `submitReview` / `requestApproval` | `plans:write` | ✅ ⚠ scoped, sequenced |
| `publish_approved_plan`  | `projectId`, `planVersionId`, `contentHash`, `idempotencyKey`                        | POST `/api/v1/projects/{projectId}/plans/{planVersionId}/publish`                 | `publishPlan`      | `plans:publish`     | ✅ ⚠ requires prior human `decidePlan` + content hash binding |
| `update_task_status`     | `projectId`, `taskId`, `expectedVersion`, `status`, `reason?`, `idempotencyKey`      | PATCH `/api/v1/projects/{projectId}/tasks/{taskId}/status`                        | `taskStatus`       | `tasks:write`       | 🧑 refused locally |
| `update_task`            | `projectId`, `taskId`, `expectedVersion`, `changes`, `idempotencyKey`                | PATCH `/api/v1/projects/{projectId}/tasks/{taskId}`                               | `taskMetadata`     | `plans:write`       | ✅ ⚠ **returns a draft `proposedPlanVersion`** that still needs approval + publication |

## Approval sequencing

`request_plan_approval` inspects the current plan state and chooses the
correct backend endpoint:

| Current plan.status             | Adapter action                                      | Rationale                                                        |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `draft`                         | POST `.../submit-review`                            | Moves `draft → in_review` so the human can decidePlan.           |
| `in_review` (`pending_approval` internally) | returns current state, no network call   | Idempotent / avoids `invalid_plan_state` on repeat requests.     |
| other (approved/rejected/published/superseded) | POST `.../request-approval`               | Backend returns a precise error if the state is terminal.        |

Human `decidePlan` (`POST /plans/{planId}/approvals` with
`{content_hash, decision, comment}`) is **x-human-only** and is explicitly
not exposed by the MCP server. The adapter's `publish_approved_plan` will
return `approval_required` if the plan is not approved by a human — the
backend enforces this independently.

## `update_task` proposal semantics

`update_task` is `plans:write`, NOT a direct task edit. The backend's
`taskMetadata` endpoint responds with HTTP 201 and a new DRAFT PlanVersion
whose snapshot contains the proposed change. The MCP tool mirrors this
exactly:

```json
{
  "proposedPlanVersion": { "id": "...", "status": "draft", "contentHash": "...", "plan": { ... } },
  "operationId": "...",
  "requiresApproval": true,
  "nextSteps": [
    "request_plan_approval(projectId, planVersionId)",
    "wait for human decidePlan (frontend)",
    "publish_approved_plan(projectId, planVersionId, contentHash)"
  ]
}
```

Clients MUST NOT treat the response as an applied edit.

## Approval status: real decision vs derived state

`get_approval_status` returns an `ApprovalStatus` that distinguishes a
real human decision from a plan-lifecycle derivation:

- Fetches the plan (`getPlan`) for `status` and `contentHash`.
- Walks a bounded slice of the project activity log (`audit`) and matches
  the decision event (`plan_approved` / `plan_rejected` / `approval.decided`
  / `decide_plan` / `plan.approved` / `plan.rejected`) by `plan_version_id`
  or `content_hash`.
- Populates `decidedBy`, `decidedAt`, and the comment (`reason`) from the
  matched audit entry.
- If `plan.status ∈ {approved, rejected}` but no audit entry matches, sets
  `reason = "derived_from_plan_state"` so operators can see the backend
  activity log is missing a decision event for this state.

## Error envelope mapping

Contract envelope: `{error:{code,message,request_id}}`. The adapter adds
one new contract code to the existing mapping:

| Backend code                   | Internal `BackendErrorCode` |
| ------------------------------ | --------------------------- |
| `unauthenticated` / `invalid_token` / `authentication_required` | `unauthorized` |
| `csrf_failed`                  | `forbidden`                 |
| `scope_insufficient` ← new     | `forbidden`                 |
| `version_conflict` / `stale_version` / `stale_project_version` / `stale_task_version` | `stale_version` |
| `idempotency_conflict`         | `idempotency_conflict`      |
| `state_conflict` / `content_hash_mismatch` | `conflict`      |
| `approval_required`            | `approval_required`         |
| `rate_limited`                 | `rate_limited`              |
| HTTP 400 / 413 / 415 / 422     | `validation_error`          |
| HTTP 429                       | `rate_limited`              |
| HTTP 500 / 502 / 503 / 504     | `backend_unavailable` / `internal_error` / `timeout` |

Internal `human_only` is a client-side policy guard; it never appears in a
backend response.

The backend's `request_id` is attached to each MCP log line as
`backendRequestId` so a cross-service trace can be reconstructed.

## REST invocation facade for n8n

In addition to the MCP Streamable HTTP endpoint, the server exposes a
server-side REST facade at `POST /invoke/<tool_name>` that dispatches
through the same authentication, principal headers, idempotency keys, and
backend adapter. It is intended for deterministic HTTP callers (n8n
`HTTP Request` nodes) that cannot speak MCP protocol. Request shape:

```http
POST /invoke/list_projects
Authorization: Bearer <UAPM_MCP_SERVICE_TOKEN>
x-on-behalf-of: <userId>
x-correlation-id: <uuid>
Content-Type: application/json

{ "arguments": { "limit": 10 } }
```

Response: `200 { "result": <tool-structured-output> }` or an error envelope
with the same error codes as above. `human_only` guards fire here too.
