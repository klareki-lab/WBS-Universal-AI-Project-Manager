import { fetch, Headers } from "undici";
import { BackendError, type BackendErrorCode } from "../errors.js";
import { logger } from "../logger.js";
import type { Config } from "../config.js";
import type {
  BackendClient,
  CreatePlanDraftInput,
  CreateProjectInput,
  ListProjectsFilter,
  ListTasksFilter,
  PageResult,
  ProposePlanChangesInput,
  PublishApprovedPlanInput,
  RequestApprovalInput,
  UpdateTaskInput,
  UpdateTaskResult,
  UpdateTaskStatusInput,
} from "./types.js";
import type {
  ActivityEntry,
  ApprovalStatus,
  OperationStatus,
  PlanDraft,
  PlanVersion,
  Principal,
  ProjectDetail,
  ProjectProgress,
  ProjectSummary,
  TaskDetail,
  TaskStatus,
  TaskSummary,
} from "../schemas.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  principal: Principal;
  idempotencyKey?: string;
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

const STATUS_TO_CODE: Record<number, BackendErrorCode> = {
  400: "validation_error",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "validation_error",
  415: "validation_error",
  422: "validation_error",
  429: "rate_limited",
  500: "internal_error",
  502: "backend_unavailable",
  503: "backend_unavailable",
  504: "timeout",
};

const CODE_MAP: Record<string, BackendErrorCode> = {
  unauthenticated: "unauthorized",
  invalid_token: "unauthorized",
  authentication_required: "unauthorized",
  csrf_failed: "forbidden",
  scope_insufficient: "forbidden",
  version_conflict: "stale_version",
  stale_version: "stale_version",
  stale_project_version: "stale_version",
  stale_task_version: "stale_version",
  idempotency_conflict: "idempotency_conflict",
  state_conflict: "conflict",
  content_hash_mismatch: "conflict",
  approval_required: "approval_required",
  rate_limited: "rate_limited",
};

// ----- Priority translation -----

function toContractPriority(p: string | undefined): string | undefined {
  if (p === "critical") return "urgent";
  return p;
}

function toInternalPriority(p: string | undefined): "low" | "medium" | "high" | "critical" {
  if (p === "urgent") return "critical";
  return (p ?? "medium") as "low" | "medium" | "high" | "critical";
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "phase"
  );
}

function toContractSnapshot(plan: PlanDraft) {
  const phases = plan.phases.map((ph) => ({
    key: slugify(ph.name),
    name: ph.name,
    description: ph.description ?? "",
  }));
  const phaseKeyByName = new Map(phases.map((p) => [p.name, p.key] as const));
  const tasks = plan.tasks.map((t) => ({
    key: t.tempId,
    phase_key: phaseKeyByName.get(t.phaseName) ?? slugify(t.phaseName),
    title: t.title,
    description: t.description ?? "",
    priority: toContractPriority(t.priority) ?? "medium",
    definition_of_done: t.definitionOfDone ?? "",
    assignee_id: null as string | null,
    start_date: null as string | null,
    due_date: t.dueDate ?? null,
    estimated_effort: t.estimateHours ?? null,
    depends_on: t.dependsOn,
  }));
  return { phases, tasks };
}

interface ContractPlanResponse {
  id: string;
  project_id: string;
  number: number;
  base_project_version: number;
  status: "draft" | "in_review" | "approved" | "published" | "superseded" | "rejected";
  snapshot: {
    phases: { key: string; name: string; description: string }[];
    tasks: {
      key: string;
      phase_key: string;
      title: string;
      description: string;
      priority: string;
      assignee_id: string | null;
      start_date: string | null;
      due_date: string | null;
      estimated_effort: number | null;
      definition_of_done: string;
      depends_on: string[];
    }[];
  };
  content_hash: string;
  created_by: string | null;
  created_at: string;
  published_at?: string | null;
}

function contractStatusToPlan(s: ContractPlanResponse["status"]): PlanVersion["status"] {
  switch (s) {
    case "in_review":
      return "pending_approval";
    case "draft":
      return "draft";
    case "approved":
      return "approved";
    case "published":
      return "published";
    case "superseded":
      return "superseded";
    case "rejected":
      return "rejected";
  }
}

function fromContractPlan(c: ContractPlanResponse): PlanVersion {
  const phaseKeyToName = new Map(c.snapshot.phases.map((p) => [p.key, p.name] as const));
  return {
    id: c.id,
    projectId: c.project_id,
    versionNumber: c.number,
    status: contractStatusToPlan(c.status),
    contentHash: c.content_hash,
    summary: null,
    createdAt: c.created_at,
    createdBy: c.created_by,
    plan: {
      summary: "",
      assumptions: [],
      risks: [],
      phases: c.snapshot.phases.map((p, i) => ({ name: p.name, order: i, description: p.description })),
      tasks: c.snapshot.tasks.map((t) => ({
        tempId: t.key,
        phaseName: phaseKeyToName.get(t.phase_key) ?? t.phase_key,
        title: t.title,
        description: t.description || undefined,
        priority: toInternalPriority(t.priority),
        dependsOn: t.depends_on,
        estimateHours: t.estimated_effort ?? undefined,
        definitionOfDone: t.definition_of_done || undefined,
        dueDate: t.due_date ?? undefined,
      })),
    },
  };
}

function fromContractProject(c: any): ProjectDetail {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    domain: null,
    ownerId: c.owner_id ?? null,
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at ?? c.created_at,
    tags: [],
    phases: [],
    currentPlanVersionId: c.published_plan_id ?? null,
  };
}

function fromContractProjectSummary(c: any): ProjectSummary {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    domain: null,
    ownerId: c.owner_id ?? null,
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at ?? c.created_at,
  };
}

function fromContractTask(c: any, projectId?: string): TaskDetail {
  return {
    id: c.id,
    projectId: c.project_id ?? projectId ?? "",
    phaseId: c.phase_id ?? null,
    title: c.title,
    description: c.description ?? null,
    status: (c.status ?? "todo") as TaskDetail["status"],
    priority: toInternalPriority(c.priority) as TaskDetail["priority"],
    assigneeId: c.assignee_id ?? null,
    dueDate: c.due_date ?? null,
    dependencies: c.depends_on ?? [],
    definitionOfDone: c.definition_of_done || null,
    estimateHours: c.estimated_effort ?? null,
    version: c.version ?? 1,
    tags: [],
    updatedAt: c.updated_at ?? c.created_at ?? new Date().toISOString(),
  };
}

function fromContractTaskSummary(c: any, projectId: string): TaskSummary {
  return {
    id: c.id,
    projectId: c.project_id ?? projectId,
    phaseId: c.phase_id ?? null,
    title: c.title,
    status: (c.status ?? "todo") as TaskStatus,
    priority: toInternalPriority(c.priority),
    assigneeId: c.assignee_id ?? null,
    dueDate: c.due_date ?? null,
    updatedAt: c.updated_at ?? c.created_at ?? new Date().toISOString(),
  };
}

function fromContractOperation(c: any): OperationStatus {
  const stateMap: Record<string, OperationStatus["state"]> = {
    queued: "pending",
    running: "in_progress",
    succeeded: "succeeded",
    failed: "failed",
  };
  return {
    operationId: c.id,
    state: stateMap[c.status] ?? "pending",
    action: c.kind ?? "unknown",
    projectId: c.project_id ?? null,
    idempotencyKey: null,
    attempts: c.attempts ?? 0,
    lastError: c.error ? { code: "backend_error", message: String(c.error) } : null,
    resultRef: c.result ? JSON.stringify(c.result).slice(0, 1024) : null,
    createdAt: c.created_at ?? new Date().toISOString(),
    updatedAt: c.updated_at ?? c.created_at ?? new Date().toISOString(),
  };
}

function fromContractActivity(c: any): ActivityEntry {
  return {
    id: c.id,
    projectId: c.project_id,
    actorId: c.actor_id ?? null,
    action: c.type,
    entityType: c.entity_type ?? "unknown",
    entityId: c.entity_id ?? null,
    createdAt: c.created_at,
    metadata: c.data ?? {},
  };
}

// Audit event types that indicate a REAL human decision on a plan version.
// Codex's activity log emits one of these for every decidePlan call.
const APPROVAL_DECISION_TYPES = new Set([
  "plan_approved",
  "plan_rejected",
  "plan.approved",
  "plan.rejected",
  "approval.decided",
  "decide_plan",
]);

// ---------- client ----------

export class HttpBackendClient implements BackendClient {
  constructor(private readonly cfg: Config) {}

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(opts.path, this.cfg.backendBaseUrl!);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers = new Headers({
      accept: "application/json",
    });
    if (opts.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.cfg.backendServiceToken) {
      headers.set("authorization", `Bearer ${this.cfg.backendServiceToken}`);
    }
    if (opts.principal.correlationId) headers.set("x-request-id", opts.principal.correlationId);
    if (opts.principal.userId) headers.set("x-on-behalf-of", opts.principal.userId);
    if (opts.idempotencyKey) headers.set("idempotency-key", opts.idempotencyKey);

    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.cfg.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);
      try {
        const res = await fetch(url, {
          method: opts.method,
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          if (res.status === 204) return undefined as T;
          return (await res.json()) as T;
        }
        let parsed: { error?: { code?: string; message?: string; request_id?: string } } = {};
        try {
          parsed = (await res.json()) as any;
        } catch {
          /* non-JSON error body */
        }
        const contractCode = parsed.error?.code;
        const mappedCode: BackendErrorCode | undefined = contractCode ? CODE_MAP[contractCode] : undefined;
        const code: BackendErrorCode = mappedCode ?? STATUS_TO_CODE[res.status] ?? "internal_error";
        const message = parsed.error?.message ?? `Backend ${res.status}`;
        if (parsed.error?.request_id) {
          logger.warn(
            { status: res.status, code, backendRequestId: parsed.error.request_id },
            "backend error",
          );
        }
        if (RETRY_STATUSES.has(res.status) && attempt <= this.cfg.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after")) * 1000 || Math.min(2 ** attempt * 100, 2000);
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        throw new BackendError(code, message, res.status, { backendRequestId: parsed.error?.request_id });
      } catch (err: any) {
        clearTimeout(timeout);
        lastErr = err;
        if (err?.name === "AbortError") {
          if (attempt <= this.cfg.maxRetries) {
            await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 100, 2000)));
            continue;
          }
          throw new BackendError("timeout", `Backend request timed out after ${this.cfg.requestTimeoutMs}ms`, 504);
        }
        if (err instanceof BackendError) throw err;
        throw new BackendError("backend_unavailable", `Backend request failed: ${err?.message ?? err}`, 503);
      }
    }
    throw lastErr instanceof BackendError
      ? lastErr
      : new BackendError("backend_unavailable", "Exceeded max retries", 503);
  }

  private humanOnly(tool: string): Promise<never> {
    return Promise.reject(
      new BackendError(
        "human_only",
        `Tool ${tool} maps to an endpoint marked x-human-only in the OpenAPI contract. ` +
          `Service bearer tokens cannot invoke it; the operation must be performed by an authenticated human via the frontend.`,
        403,
      ),
    );
  }

  private async currentProjectVersion(p: Principal, projectId: string): Promise<number> {
    const raw = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
      principal: p,
    });
    const v = Number(raw?.version);
    if (!Number.isInteger(v) || v < 1) {
      throw new BackendError("validation_error", `Backend returned invalid project version: ${raw?.version}`, 500);
    }
    return v;
  }

  // ----- READS -----

  async listProjects(p: Principal, f: ListProjectsFilter): Promise<PageResult<ProjectSummary>> {
    const page = await this.request<{ items: any[]; next_offset?: number | null }>({
      method: "GET",
      path: "/api/v1/projects",
      query: {
        limit: f.limit,
        offset: f.cursor ? Number(f.cursor) : undefined,
      },
      principal: p,
    });
    return {
      items: (page.items ?? []).map(fromContractProjectSummary),
      nextCursor: page.next_offset != null ? String(page.next_offset) : null,
    };
  }

  async getProject(p: Principal, id: string): Promise<ProjectDetail> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(id)}`,
      principal: p,
    });
    return fromContractProject(c);
  }

  async listProjectTasks(p: Principal, projectId: string, f: ListTasksFilter): Promise<PageResult<TaskSummary>> {
    const page = await this.request<{ items: any[]; next_offset?: number | null }>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`,
      query: {
        limit: f.limit,
        offset: f.cursor ? Number(f.cursor) : undefined,
        status: f.status,
        priority: toContractPriority(f.priority),
      },
      principal: p,
    });
    return {
      items: (page.items ?? []).map((t) => fromContractTaskSummary(t, projectId)),
      nextCursor: page.next_offset != null ? String(page.next_offset) : null,
    };
  }

  async getTask(p: Principal, projectId: string, taskId: string): Promise<TaskDetail> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      principal: p,
    });
    return fromContractTask(c, projectId);
  }

  async getPlanVersion(p: Principal, projectId: string, planVersionId: string): Promise<PlanVersion> {
    const c = await this.request<ContractPlanResponse>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planVersionId)}`,
      principal: p,
    });
    return fromContractPlan(c);
  }

  async getCurrentPublishedPlan(p: Principal, projectId: string): Promise<PlanVersion | null> {
    const project = await this.getProject(p, projectId);
    if (!project.currentPlanVersionId) return null;
    return this.getPlanVersion(p, projectId, project.currentPlanVersionId);
  }

  async getProjectProgress(p: Principal, projectId: string): Promise<ProjectProgress> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`,
      principal: p,
    });
    const byStatus: Record<string, number> = c.task_counts_by_status ?? c.counts_by_status ?? {};
    const total = Object.values(byStatus).reduce((a, b) => a + (b as number), 0);
    const done = (byStatus["done"] as number) ?? 0;
    return {
      projectId,
      counts: { total, byStatus: byStatus as ProjectProgress["counts"]["byStatus"] },
      overdue: c.overdue_count ?? c.overdue ?? 0,
      blockers: (c.blockers ?? []).map((b: any) => ({ taskId: b.task_id, reason: b.reason ?? "blocker" })),
      completionRatio: total ? done / total : 0,
      updatedAt: c.updated_at ?? new Date().toISOString(),
    };
  }

  /**
   * Returns an ApprovalStatus that distinguishes a *real* human decision
   * (populated from the project activity log) from a *derived* plan state
   * (plan.status === "approved"/"rejected" with no corresponding audit event).
   *
   * If a plan is marked approved/rejected in the plan table but the audit
   * log does not carry a `plan_approved`/`plan_rejected` entry for its
   * content hash, the returned `decidedBy`/`decidedAt` remain null and
   * `derivedFromPlanState=true` is set in `reason` for operator inspection.
   */
  async getApprovalStatus(p: Principal, projectId: string, planVersionId: string): Promise<ApprovalStatus> {
    const plan = await this.getPlanVersion(p, projectId, planVersionId);
    const state: ApprovalStatus["state"] =
      plan.status === "approved" || plan.status === "published"
        ? "approved"
        : plan.status === "rejected"
        ? "rejected"
        : plan.status === "pending_approval"
        ? "pending"
        : plan.status === "superseded"
        ? "approved" // was approved historically; superseded by a later publication
        : "none";
    // Walk a bounded slice of the audit log for a matching decision event.
    let decidedBy: string | null = null;
    let decidedAt: string | null = null;
    let decisionComment: string | null = null;
    let derivedFromPlanState = state === "approved" || state === "rejected";
    try {
      const activity = await this.listActivityHistory(p, projectId, undefined, 100);
      for (const entry of activity.items) {
        if (!APPROVAL_DECISION_TYPES.has(entry.action)) continue;
        const metaPlanId = (entry.metadata as any)?.plan_version_id ?? (entry.metadata as any)?.planVersionId;
        const metaHash = (entry.metadata as any)?.content_hash ?? (entry.metadata as any)?.contentHash;
        if (metaPlanId === planVersionId || metaHash === plan.contentHash || entry.entityId === planVersionId) {
          decidedBy = entry.actorId;
          decidedAt = entry.createdAt;
          decisionComment = (entry.metadata as any)?.comment ?? null;
          derivedFromPlanState = false;
          break;
        }
      }
    } catch {
      /* audit read failure is non-fatal — leave decidedBy null */
    }
    return {
      planVersionId,
      state,
      requestedBy: plan.createdBy,
      requestedAt: plan.createdAt,
      decidedBy,
      decidedAt,
      reason: decisionComment ?? (derivedFromPlanState ? "derived_from_plan_state" : null),
    };
  }

  async listActivityHistory(p: Principal, projectId: string, cursor?: string, limit?: number): Promise<PageResult<ActivityEntry>> {
    const page = await this.request<{ items: any[]; next_offset?: number | null }>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/activity`,
      query: {
        limit,
        offset: cursor ? Number(cursor) : undefined,
      },
      principal: p,
    });
    return {
      items: (page.items ?? []).map(fromContractActivity),
      nextCursor: page.next_offset != null ? String(page.next_offset) : null,
    };
  }

  async getOperationStatus(p: Principal, operationId: string): Promise<OperationStatus> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/operations/${encodeURIComponent(operationId)}`,
      principal: p,
    });
    return fromContractOperation(c);
  }

  // ----- MUTATIONS -----

  async createProject(_p: Principal, _input: CreateProjectInput): Promise<never> {
    return this.humanOnly("create_project");
  }

  async createPlanDraft(p: Principal, input: CreatePlanDraftInput) {
    const base_project_version = await this.currentProjectVersion(p, input.projectId);
    const c = await this.request<ContractPlanResponse>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/plans`,
      body: { base_project_version, snapshot: toContractSnapshot(input.plan) },
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    return { planVersion: fromContractPlan(c), operationId: c.id };
  }

  async proposePlanChanges(p: Principal, input: ProposePlanChangesInput) {
    const base_project_version = await this.currentProjectVersion(p, input.projectId);
    const c = await this.request<ContractPlanResponse>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/change-proposals`,
      body: {
        base_project_version,
        snapshot: toContractSnapshot(input.plan),
        rationale: input.rationale ?? undefined,
      },
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    return { planVersion: fromContractPlan(c), operationId: c.id };
  }

  /**
   * `submit-review` moves a draft plan into `in_review` state so a human can
   * decidePlan. `request-approval` is a separate endpoint that is accepted
   * only on draft plans (it is a parallel entry point to submit-review and
   * does not stack on top of it). The adapter picks the correct endpoint
   * based on the plan's current status so callers see a single logical
   * "please route this to human approval" operation.
   */
  async requestPlanApproval(p: Principal, input: RequestApprovalInput) {
    const current = await this.getPlanVersion(p, input.projectId, input.planVersionId);
    let c: ContractPlanResponse;
    if (current.status === "draft") {
      // Prefer submit-review; the backend smoke test uses this sequence
      // (plan.draft → submit-review → in_review → decidePlan).
      c = await this.request<ContractPlanResponse>({
        method: "POST",
        path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/plans/${encodeURIComponent(input.planVersionId)}/submit-review`,
        principal: p,
        idempotencyKey: input.idempotencyKey,
      });
    } else if (current.status === "pending_approval") {
      // Already in review — return the current state without a redundant call.
      c = {
        id: current.id,
        project_id: current.projectId,
        number: current.versionNumber,
        base_project_version: 1,
        status: "in_review",
        snapshot: { phases: [], tasks: [] } as any,
        content_hash: current.contentHash,
        created_by: current.createdBy,
        created_at: current.createdAt,
      };
    } else {
      // Terminal states — fall through so the backend returns a clean error.
      c = await this.request<ContractPlanResponse>({
        method: "POST",
        path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/plans/${encodeURIComponent(input.planVersionId)}/request-approval`,
        principal: p,
        idempotencyKey: input.idempotencyKey,
      });
    }
    const pv = fromContractPlan(c);
    return {
      approval: {
        planVersionId: pv.id,
        state: pv.status === "approved" ? "approved" : pv.status === "rejected" ? "rejected" : "pending",
        requestedBy: pv.createdBy,
        requestedAt: pv.createdAt,
        decidedBy: null,
        decidedAt: null,
        reason: input.note ?? null,
      } as ApprovalStatus,
      operationId: pv.id,
    };
  }

  async publishApprovedPlan(p: Principal, input: PublishApprovedPlanInput) {
    const c = await this.request<any>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/plans/${encodeURIComponent(input.planVersionId)}/publish`,
      body: { content_hash: input.contentHash },
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    const op = fromContractOperation(c);
    const publishedTaskIds: string[] = Array.isArray(c?.result?.task_ids) ? c.result.task_ids : [];
    // After the publish operation succeeds the plan version becomes "published".
    // Return null for the plan version to force callers to re-read it rather
    // than reasoning from the operation's input snapshot.
    return {
      planVersion: null as PlanVersion | null,
      publishedTaskIds,
      operationId: op.operationId,
    };
  }

  async updateTaskStatus(_p: Principal, _input: UpdateTaskStatusInput): Promise<never> {
    return this.humanOnly("update_task_status");
  }

  /**
   * `taskMetadata` is service-callable (`plans:write`) but its response is
   * a NEW DRAFT plan version containing the proposed change. Nothing in
   * the task is applied in place. The caller must route the returned plan
   * version through the normal approval + publication pipeline for the
   * modification to take effect.
   */
  async updateTask(p: Principal, input: UpdateTaskInput): Promise<UpdateTaskResult> {
    const body: Record<string, unknown> = { version: input.expectedVersion };
    if (input.changes.title !== undefined) body.title = input.changes.title;
    if (input.changes.description !== undefined) body.description = input.changes.description;
    if (input.changes.priority !== undefined) body.priority = toContractPriority(input.changes.priority);
    if (input.changes.assigneeId !== undefined) body.assignee_id = input.changes.assigneeId;
    if (input.changes.startDate !== undefined) body.start_date = input.changes.startDate;
    if (input.changes.dueDate !== undefined) body.due_date = input.changes.dueDate;
    if (input.changes.estimateHours !== undefined) body.estimated_effort = input.changes.estimateHours;
    if (input.changes.definitionOfDone !== undefined) body.definition_of_done = input.changes.definitionOfDone;
    const c = await this.request<ContractPlanResponse>({
      method: "PATCH",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.taskId)}`,
      body,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    const planVersion = fromContractPlan(c);
    return {
      proposedPlanVersion: planVersion,
      operationId: planVersion.id,
      requiresApproval: true,
      nextSteps: [
        "request_plan_approval(projectId, planVersionId)",
        "wait for human decidePlan (frontend)",
        "publish_approved_plan(projectId, planVersionId, contentHash) — requires plans:publish",
      ],
    };
  }

  /**
   * Agent → async-planning callback writer. Service identity needs
   * `operations:write` + `plans:write`. This is the direct wrapper over
   * `POST /api/v1/operations/{operationId}/result`. The MCP server does
   * not expose this as a tool by default; n8n invokes the backend directly
   * via its own worker identity.
   */
  async operationResult(
    p: Principal,
    operationId: string,
    body: { result?: { base_project_version: number; snapshot: ReturnType<typeof toContractSnapshot> }; error?: string },
    idempotencyKey: string,
  ) {
    return this.request<any>({
      method: "POST",
      path: `/api/v1/operations/${encodeURIComponent(operationId)}/result`,
      body,
      principal: p,
      idempotencyKey,
    });
  }
}
