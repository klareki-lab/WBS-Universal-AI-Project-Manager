# uapm-mcp Tool Catalog

16 tools: 9 read, 7 controlled mutations. No destructive tools in v1.
All mutations require an `idempotencyKey` and are enforced by the backend.

## Read tools

| Tool                    | Input (summary)                                                                 | Output (summary)                                   | Backend route (contract)                         |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `list_projects`         | `cursor?`, `limit?`, `status?`, `query?`                                        | `{items[], nextCursor, total?}`                    | `GET /v1/projects`                               |
| `get_project`           | `id`                                                                            | ProjectDetail                                      | `GET /v1/projects/:id`                           |
| `list_project_tasks`    | `projectId`, `cursor?`, `limit?`, `status?`, `priority?`, `phaseId?`            | `{items[], nextCursor, total?}`                    | `GET /v1/projects/:id/tasks`                     |
| `get_task`              | `id`                                                                            | TaskDetail                                         | `GET /v1/tasks/:id`                              |
| `get_plan_version`      | `id`                                                                            | PlanVersion (id, versionNumber, status, hash, plan) | `GET /v1/plan-versions/:id`                      |
| `get_project_progress`  | `projectId`                                                                     | counts/overdue/blockers/completionRatio            | `GET /v1/projects/:id/progress`                  |
| `get_approval_status`   | `planVersionId`                                                                 | ApprovalStatus                                     | `GET /v1/plan-versions/:id/approval`             |
| `list_activity_history` | `projectId`, `cursor?`, `limit?`                                                | `{items[], nextCursor}`                            | `GET /v1/projects/:id/activity`                  |
| `get_operation_status`  | `operationId`                                                                   | OperationStatus (state, attempts, lastError, …)    | `GET /v1/operations/:id`                         |

## Mutation tools

| Tool                    | Input (summary)                                                                 | Output                                             | Backend route (contract)                         |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `create_project`        | `name`, `description?`, `domain?`, `tags?`, `idempotencyKey`                    | `{project, operationId}`                           | `POST /v1/projects`                              |
| `create_plan_draft`     | `projectId`, `plan` (PlanDraft), `idempotencyKey`                               | `{planVersion, operationId}`                       | `POST /v1/projects/:id/plan-drafts`              |
| `propose_plan_changes`  | `projectId`, `basePlanVersionId`, `plan`, `rationale?`, `idempotencyKey`        | `{planVersion, operationId}`                       | `POST /v1/projects/:id/plan-proposals`           |
| `request_plan_approval` | `planVersionId`, `note?`, `idempotencyKey`                                      | `{approval, operationId}`                          | `POST /v1/plan-versions/:id/approval-requests`   |
| `publish_approved_plan` | `planVersionId`, `idempotencyKey`                                               | `{planVersion, publishedTaskIds, operationId}`     | `POST /v1/plan-versions/:id/publish`             |
| `update_task_status`    | `taskId`, `expectedVersion`, `status`, `reason?`, `idempotencyKey`              | `{task, operationId}`                              | `POST /v1/tasks/:id/status`                      |
| `update_task`           | `taskId`, `expectedVersion`, `changes` (allowed subset), `idempotencyKey`       | `{task, operationId, requiresApproval}`            | `PATCH /v1/tasks/:id`                            |

### PlanDraft schema (shared)

```ts
{
  summary: string,
  assumptions: string[],
  risks: string[],
  phases: [{ name: string, order: number, description?: string }],
  tasks: [{
    tempId: string,
    phaseName: string,
    title: string,
    description?: string,
    priority: "low"|"medium"|"high"|"critical",
    dependsOn: string[],
    estimateHours?: number,
    definitionOfDone?: string,
    owner?: string,
    dueDate?: string
  }]
}
```

### Status transition rules (`update_task_status`)

| From          | To (allowed)                                       |
| ------------- | -------------------------------------------------- |
| `backlog`     | `todo`, `cancelled`                                |
| `todo`        | `in_progress`, `blocked`, `cancelled`              |
| `in_progress` | `in_review`, `blocked`, `done`, `cancelled`        |
| `blocked`     | `in_progress`, `cancelled`                         |
| `in_review`   | `in_progress`, `done`                              |
| `done`        | (terminal)                                         |
| `cancelled`   | (terminal)                                         |

Any other transition returns `validation_error`. Stale `expectedVersion`
returns `stale_version` (optimistic concurrency).

### High-impact field policy (`update_task`)

`priority`, `assigneeId`, `dueDate` are blocked at the backend. Clients
receive `approval_required` with the recommended flow:
`propose_plan_changes` → `request_plan_approval` → `publish_approved_plan`.

### Error codes

| Code                   | HTTP | Meaning                                                        |
| ---------------------- | ---- | -------------------------------------------------------------- |
| `unauthorized`         | 401  | Missing/invalid service token or principal                     |
| `forbidden`            | 403  | Principal has no access to the resource                        |
| `not_found`            | 404  | Entity does not exist                                          |
| `conflict`             | 409  | Entity state prevents the operation                            |
| `validation_error`     | 400/422 | Input shape / transition rule violated                      |
| `approval_required`    | 403  | A human approval must exist before this operation              |
| `stale_version`        | 409  | Optimistic concurrency conflict (`expectedVersion` mismatch)   |
| `idempotency_conflict` | 409  | Idempotency key already consumed by another operation          |
| `rate_limited`         | 429  | Backend returned 429; honour `retry-after`                     |
| `backend_unavailable`  | 502/503 | Backend network/5xx error                                   |
| `timeout`              | 504  | Request timed out                                              |
| `internal_error`       | 500  | Unexpected server failure                                      |

### Idempotency behaviour

- Every mutation requires `idempotencyKey` (≥8 chars).
- Same key reused during a race: backend returns the recorded operation
  (clients MUST call `get_operation_status` before retrying when the key
  was already used but the outcome is unknown).
- Mock backend: duplicates reject with `idempotency_conflict`;
  real backend may instead return the original result (depending on
  contract decision in `packages/contracts/openapi.yaml`).
