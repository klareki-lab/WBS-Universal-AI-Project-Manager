# Frontend / Backend API contract — draft v2

**Provisional TypeScript only. No authoritative HTTP endpoints are specified.** Full interfaces: `src/api/types.ts`.

| Logical operation | Request | Response | Intended behavior |
|---|---|---|---|
| `listProjects`, `getProject` | optional ID | `Project[]`, `Project` | Native portfolio; backend owns health/progress calculation |
| `createProject` | `NewProjectInput` | `{project,plan}` | Atomic project creation and draft (or separate operations if contract requires) |
| `listTasks` | project ID | `Task[]` | Operative tasks independent of plan draft |
| `createTask`, `updateTask` | project/task ID + patch | `Task` | Own DB mutation; backend authorization and cycle validation |
| `listMembers` | project ID | `User[]` | Authorized assignments only |
| `listPlans`, `getPlan` | project/version ID | `PlanVersion[]`, `PlanVersion` | Immutable snapshot bodies |
| `createDraftFromApproved` | project ID | `PlanVersion` | Fork current approved snapshot |
| `reviseTask`, `addTaskFromDescription` | project + current draft version ID | new `PlanVersion` | Concurrency-safe fork, not mutation in place |
| `diffPlan` | project + candidate version ID | `PlanDiff` | Diff against current approved baseline |
| `approveVersion` | project + **exact version ID** | `Approval` | Atomic decision + safe native publication policy |
| `rejectVersion`, `requestRevision` | project + exact version + note | void / new `PlanVersion` | Deterministic workflow state transition |
| `listApprovals` | project ID | `Approval[]` | Durable audit history |
| `assistantMessage` | project + text + intent | `AgentMessage` | `read_only` answer OR `proposal`; no silent mutation |
| `listConversation` | project ID | `AgentConversation` | Project-scoped historical messages |
| `listProposals`, `applyProposal`, `rejectProposal` | project/proposal ID | proposal list / new draft / void | Explicit human action for mutations |
| `listActivity`, `listOperations` | optional project ID | event/job lists | Structured operations with retry metadata |
| `getCapabilities` | none | `AppCapabilities` | Feature availability, AI mode, optional integrations |

Error design: typed error `code`, German user-safe `message`, `retrySafe` boolean, conflict/current-version details. The frontend currently distinguishes `CONFLICT`, `VALIDATION`, `NOT_FOUND`, `UNAVAILABLE`; server codes must be negotiated. JSON pagination, authorization, timestamps, ETags, optimistic revisions, idempotency keys, role membership and operation polling/SSE must be reconciled before implementing `httpTransport` routes.

Future AI/MCP responses must distinguish `answer` from a typed `proposed_action` and include `proposalId`, `basePlanVersionId`, expected effects, warnings, approval requirement and optional operation reference. Frontend does not send MCP/service credentials.
