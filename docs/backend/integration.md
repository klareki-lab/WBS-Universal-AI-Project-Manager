# Frontend and MCP/n8n integration contract v1.0.0

For Astra/frontend and Claude Code/MCP: `packages/contracts/openapi.yaml` is the canonical REST contract. `packages/contracts/types.ts` is generated with openapi-typescript; JSON Schemas are in `packages/contracts/schemas/`. Import the generated types or generate your client from OpenAPI. Changes to field names, endpoint behavior or enums require an explicit contract changelog and version bump. `npm run contracts` regenerates artifacts; automated tests compare the runtime schema to published JSON Schema and validate OpenAPI.

No direct message was sent to another agent or external collaborator. This document, committed fixtures and the backend PR are the merge-ready coordination artifacts. Existing frontend/MCP branches were not edited.

## Frontend sequence

1. Human login saves the session cookie and returned CSRF token. Use `credentials: 'include'`. Refresh without a stored CSRF token requires a new login (there is no endpoint exposing a new CSRF secret).
2. POST `/api/v1/projects` with `{name,description}`. Persist its UUID and optimistic `version`.
3. POST `/api/v1/projects/{projectId}/plans` with `fixtures/plan-create.json` shape and current `base_project_version`.
4. Render the saved GET plan response, including content hash and unresolved/null values. Do not invent ownership, dates, effort or budgets. Project ownership is the authenticated creator; task assignees remain nullable.
5. POST `.../plans/{planId}/submit-review` (no body) or `request-approval`.
6. Human explicitly approves POST `.../plans/{planId}/approvals` with `{content_hash,decision:'approved',comment}`. Rejection uses `decision:'rejected'`.
7. POST `.../plans/{planId}/publish` with `{content_hash}`. Returns a succeeded operation with task IDs. Fetch tasks/dashboard; never infer successful publication from model output.
8. Status PATCH takes `{version,status}` and returns a Task. Metadata PATCH takes `{version,...changedFields}` and returns a **new PlanVersion**, with HTTP 201; review/approve/publish it before showing metadata as committed.
9. Every domain mutation needs a stable Idempotency-Key for retries of that exact command. Use a new key for a new logical command. On 409 stale versions, refresh state and ask the human to review the new proposal. On a lost response, retry the same key. Lists paginate via limit/offset; order is stable by time/UUID or plan number. Task search `q` is a case-insensitive substring match.

Error envelope: `{error:{code,message,request_id}}`. Display useful conflict messages and retain request_id for support. 401 means authentication is needed; 403 means access/scope/CSRF failed; 404 conceals unavailable resources; 409 is a state/version/hash/idempotency conflict; 400 means invalid input.

## MCP-facing operation mapping

MCP implementation remains owned by Claude Code. The following are suggested tool names mapped directly to canonical OpenAPI operationId values:

| MCP operation | HTTP operationId | Required service scope |
|---|---|---|
| list_projects | listProjects | read |
| get_project / dashboard | getProject / dashboard | read |
| list_tasks / get_task / dependencies | listTasks / getTask / dependencies | read |
| create_plan_draft | createPlan | plans:write |
| propose_changes | proposeChanges | plans:write |
| propose_task_metadata | taskMetadata | plans:write |
| list_plans / get_plan | listPlans / getPlan | read |
| submit_review / request_approval | submitReview / requestApproval | plans:write |
| publish_approved_plan | publishPlan | plans:publish (optional explicit grant) |
| request_agent_plan | planningRequest | operations:write |
| get_operation / recent_operations | getOperation / listOperations | read |
| store_agent_result | operationResult | operations:write AND plans:write; service only |
| correlate_conversation | conversation | operations:write |
| read_audit | audit | read |

Approval, project creation/metadata, and task status endpoints are human-only. Do not expose an MCP approve tool or reuse human cookies. A claimed approval in text is not authorization. A service needs project membership even with a matching scope. There is no direct database contract for MCP.

## n8n adapter

POST `/api/v1/projects/{projectId}/agent/planning-requests` with `{prompt,conversation_session_id?}` returns 202 OperationJob. Conversation UUIDs come from POST `.../conversations` with `{provider,external_id}`; correlations are unique per project/provider/external ID.

When N8N_ENDPOINT/N8N_TOKEN are configured the worker sends:

```json
{
  "operation_id": "uuid",
  "project_id": "uuid",
  "conversation_session_id": null,
  "input": {"prompt": "Prepare a draft", "base_project_version": 1},
  "callback_path": "/api/v1/operations/uuid/result"
}
```

Headers: `Authorization: Bearer <N8N_TOKEN>`, `Idempotency-Key: <operation_id>`, `X-Request-ID: <operation_id>`, `Content-Type: application/json`. The endpoint is configured by the operator, never by the model. It must not redirect.

Synchronous response: HTTP 200 `{result:{base_project_version,snapshot}}` or `{error:'Clarification required'}`. No free-form Markdown parsing occurs. A successful result saves only a draft, without approval or publication. The task structure is exactly `fixtures/plan-create.json`.

Async response: HTTP 202 (no body required), then POST callback_path using a provisioned backend service bearer token, a stable callback Idempotency-Key, and the same `{result:...}` or `{error:...}` shape. Error and result are mutually exclusive. Callbacks expire operationally when the job reaches a terminal state. Callback within 60 seconds avoids lease redelivery. Three deliveries maximum; expired exhausted leases fail. For longer workflows, n8n should deduplicate/re-attach by operation_id and return the original result; it must not start duplicate model work. There is no heartbeat/lease extension API in v1.

The browser polls GET `/api/v1/operations/{operationId}` and reads `queued|running|succeeded|failed`. An unconfigured adapter leaves jobs queued for later delivery. That is visible state, not a fabricated success. Succeeded planning result contains `{plan_version_id,content_hash}`. Succeeded publication result contains `{plan_version_id,task_ids,task_count}`. Polling is project-authorized.

## Compose merge notes

The fragment `infra/backend/compose.yaml` is independently runnable as project `uapm-dev`. Service names are `backend` and `postgres`; network key is `backend`, volume key `postgres-data`. Frontend can use the host API; another Compose service can call `http://backend:3001` only when attached to this development network. MCP receives no PostgreSQL secrets or volume mounts. A future root Compose should copy/merge this fragment deliberately, preserve loopback bindings and avoid duplicate port assignments. Do not automatically include or change production n8n stacks.
