# Frontend and MCP/n8n integration contract v1.1.0

For Astra/frontend and Claude Code/MCP: `packages/contracts/openapi.yaml` is the canonical REST contract. `packages/contracts/types.ts` is generated with openapi-typescript; JSON Schemas are in `packages/contracts/schemas/`. Import the generated types or generate your client from OpenAPI. Changes to field names, endpoint behavior or enums require an explicit contract changelog and version bump. `npm run contracts` regenerates artifacts; automated tests compare the runtime schema to published JSON Schema and validate OpenAPI.

This versioned document, committed fixtures and PR #1 carry the interface update for Astra and Claude Code. See `remediation/FRONTEND_GAPS.md` and `remediation/APPROVAL_POLICY.md` for the audited decisions. Existing frontend/MCP branches were not edited.

## Frontend sequence

1. Human login saves the session cookie and returned CSRF token. Use `credentials: 'include'`. After reload, GET `/api/v1/auth/csrf` with the HttpOnly cookie to bootstrap a stable CSRF token without re-login. Never read or persist the session cookie in JavaScript.
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
  "request_id": "original-backend-request-uuid",
  "context_hash": "backend-assigned-64-character-hash",
  "project_id": "uuid",
  "conversation_session_id": null,
  "input": {"prompt": "Prepare a draft", "base_project_version": 1},
  "callback_path": "/api/v1/operations/uuid/result"
}
```

Headers: `Authorization: Bearer <N8N_TOKEN>`, `Idempotency-Key: <operation_id>`, `X-Request-ID: <operation_id>`, `Content-Type: application/json`. The endpoint is configured by the operator, never by the model. It must not redirect.

Synchronous response: HTTP 200 `{result:{base_project_version,snapshot}}` or `{error:'Clarification required'}`. No free-form Markdown parsing occurs. A successful result saves only a draft, without approval or publication. The task structure is exactly `fixtures/plan-create.json`.

Async response: HTTP 202 (no body required), then POST callback_path using a provisioned backend service bearer token, a stable callback Idempotency-Key, and the same `{result:...}` or `{error:...}` shape. Error and result are mutually exclusive strict union branches; `{}`, both fields, an empty error, or extra fields return 400 and fail JSON Schema. The callback body remains `{result:...}` OR `{error:...}`; **do not echo delivery metadata in the body**. The operation UUID is in the callback path. The backend validates persisted operation/request identity, immutable context hash, original base, current project version and current originating authorization. A stale or relabeled result returns 409 without saving a draft or success record; request a new operation. The worker uses the same checks before delivery and before applying synchronous results. Callbacks expire operationally when the job reaches a terminal state. Callback within 60 seconds avoids lease redelivery. Three deliveries maximum; expired exhausted leases fail. For longer workflows, n8n should deduplicate/re-attach by operation_id and return the original result; it must not start duplicate model work. There is no heartbeat/lease extension API in v1.

The browser polls GET `/api/v1/operations/{operationId}` and reads `queued|running|succeeded|failed`. An unconfigured adapter leaves jobs queued for later delivery. That is visible state, not a fabricated success. Succeeded planning result contains `{plan_version_id,content_hash}`. Succeeded publication result contains `{plan_version_id,task_ids,task_count}`. Polling is project-authorized.

## Compose merge notes

The fragment `infra/backend/compose.yaml` is independently runnable as project `uapm-dev`. Service names are `backend` and `postgres`; network key is `backend`, volume key `postgres-data`. Frontend can use the host API; another Compose service can call `http://backend:3001` only when attached to this development network. MCP receives no PostgreSQL secrets or volume mounts. A future root Compose should copy/merge this fragment deliberately, preserve loopback bindings and avoid duplicate port assignments. Do not automatically include or change production n8n stacks.

## v1.1.0 approval/replay and Unicode semantics

Pending approvals can be revoked using POST `.../plans/{planId}/revoke-approval` with `{reason}`, by the human project owner or original approver while currently authorized to write. GET `.../plans/{planId}/approvals` returns immutable decisions and revocations. Disable, membership removal and downgrade permanently revoke unconsumed approvals; reactivation does not revive them. Already consumed publications remain historical. See the explicit product/security decision in `remediation/APPROVAL_POLICY.md`.

Every mutation replay rechecks current user/session/token, scopes and write membership, including project creation whose resource UUID is absent from the URL. Revoked access returns normal 404/403 rather than a cached success.

All persisted text rejects NUL and lone UTF-16 surrogates; legitimate Unicode and multiline text remain supported. Cross-field task date order, paired task_id/expected_version, graph acyclicity and database/project references remain documented semantic 400 constraints beyond structural JSON Schema. Callback exclusivity is encoded structurally and tested with an independent Ajv corpus.

Migration 003 backfills project context for old idempotency records and fails old pending planning operations that lack verifiable context. Completed history remains readable. Integrators must enqueue a fresh planning request for those legacy operations.
