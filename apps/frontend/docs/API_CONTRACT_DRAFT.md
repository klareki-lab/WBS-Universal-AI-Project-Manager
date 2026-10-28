# Typed API Contract — DRAFT / Awaiting Backend Lead

**Status:** provisional TypeScript domain design for reconciliation, *not* a specification of final HTTP routes. There are deliberately no hardcoded backend endpoints, method mappings, Jira paths, model URLs, tenant IDs, or authorization mechanisms in the frontend.

## Domain DTOs

Authoritative interfaces: [`src/api/types.ts`](../src/api/types.ts).

| Entity | Minimum fields | Ownership / invariants |
|---|---|---|
| `Project` | `id`, `name`, `description`, `type`, `targetDate`, `status`, `progress`, draft/approved IDs | Backend stores project state; target date as ISO date. |
| `Phase` | `id`, `title`, `description`, `order` | Scoped to one `PlanVersion`. |
| `Task` | `id`, `phaseId`, `title`, `description`, `status`, `priority`, `estimateDays`, `dependsOn[]`, optional `jiraIssue` | Plan-snapshot task; Jira issue URL only from verified backend Jira response. |
| `PlanVersion` | `id`, `projectId`, `version`, `status`, timestamps, `phases`, `tasks`, `warnings` | Stable ID; content immutable after creation. Draft edits create a new version. |
| `Approval` | `id`, `projectId`, **`planVersionId`**, `approvedAt`, `approvedByLabel`, `simulated` | Production approval backend-authenticated and bound to exact version ID; no mutable latest alias. |
| `SyncJob` | `id`, `projectId`, `planVersionId`, `state`, `retrySafe`, `results[]`, `simulated` | Async backend-driven; `queued / running / completed / partial / failed`; explicit idempotent retry. |
| `ActivityEvent` | `id`, `projectId?`, `at`, `category`, `title`, `detail`, `level`, `simulated` | Backend audit provenance, timestamp and actor. |

Possible schema changes must be agreed before implementing the real adapter. `simulated` appears only in this prototype; real DTOs may instead include `environment` or omit the property entirely.

## Provisional API port (not URL endpoints)

```ts
interface ProjectApi {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  getPlan(id: string): Promise<PlanVersion>;
  listPlans(projectId: string): Promise<PlanVersion[]>;
  createProject(input: NewProjectInput): Promise<{ project: Project; plan: PlanVersion }>;
  reviseTask(projectId: string, baseVersionId: string, taskId: string, patch: TaskEdit): Promise<PlanVersion>;
  addTaskFromDescription(projectId: string, baseVersionId: string, description: string): Promise<PlanVersion>;
  demoPlanningReply(message: string): Promise<PlanningReply>;
  approveVersion(projectId: string, planVersionId: string): Promise<Approval>;
  listApprovals(projectId: string): Promise<Approval[]>;
  previewJiraChanges(projectId: string, planVersionId: string): Promise<JiraPreview>;
  getIntegrationStatus(): Promise<IntegrationStatus>;
  listSyncJobs(projectId?: string): Promise<SyncJob[]>;
  listActivity(projectId?: string): Promise<ActivityEvent[]>;
}
```

**Expected production adjustments:** `demoPlanningReply` should become a backend conversation/message operation with streaming/polling and durable conversation IDs; the deterministic `addTaskFromDescription` is demo-only, not necessarily a real backend operation. The Backend Lead should approve exact request payloads, error codes, concurrency semantics and pagination.

## State transitions

- `draft vN` + edit -> `superseded vN` + `draft vN+1` (new snapshot and new ID)
- `draft vN` + explicit approval ID -> `approved vN` + `Approval(planVersionId=vN.id)`
- `approved vN` -> never edited in-place; later changes must be a new draft derived by a backend-defined fork operation (not implemented in mock UI).
- Sync preview is read-only, even before approval. Sync execution **must be gated** on backend authorization and approved version.
- Job states: `queued -> running -> completed | partial | failed`. Job state may require retry/reconciliation. `partial` cannot automatically repeat all mutations.

## HTTP transport boundary

`src/api/httpTransport.ts` provides `ConfigurableTransport` that accepts an injected `RouteMap`. It has **zero default route paths**. CORS/session auth and CSRF remain Backend Lead choices. It is not connected to the app until reconciliation.

Errors expose `retrySafe`; ambiguous network timeouts and conflicts must never be assumed retryable for non-idempotent operations. UI explains to check current state before resubmission.

## Jira mutation preview

`JiraPreview` returns `projectId`, **`planVersionId`**, `changes` (`create|update|skip`) and `allowedToExecute`. Mock preview *always* reports false. In production the preview should include mapping validation, permission checks, deduplication policy and an idempotency token before any execution.
