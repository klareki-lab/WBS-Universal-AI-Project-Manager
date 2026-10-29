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

// Contract-specific codes mapped to our internal taxonomy.
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

// ----- Internal <-> contract mapping -----

function hasValidPriority(p?: string): asserts p {
  // Internal priority allows "critical"; contract expects "urgent".
  // Translate on write; translate back on read.
}

function toContractPriority(p: string | undefined): string | undefined {
  if (p === "critical") return "urgent";
  return p;
}

function toInternalPriority(p: string | undefined): "low" | "medium" | "high" | "critical" {
  if (p === "urgent") return "critical";
  return (p ?? "medium") as "low" | "medium" | "high" | "critical";
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "phase";
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
      return "pending_approval"; // closest internal state
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
    if(opts.body !== undefined) headers.set("content-type","application/json");
    if (this.cfg.backendServiceToken) {
      headers.set("authorization", `Bearer ${this.cfg.backendServiceToken}`);
    }
    if (opts.principal.correlationId) headers.set("x-request-id", opts.principal.correlationId);
    // The backend derives the service identity + membership from the bearer.
    // We attach on-behalf-of for audit correlation only; backend decides trust.
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
          logger.warn({ status: res.status, code, backendRequestId: parsed.error.request_id }, "backend error");
        }
        if (RETRY_STATUSES.has(res.status) && attempt <= this.cfg.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after")) * 1000 || Math.min(2 ** attempt * 100, 2000);
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        throw new BackendError(code, message, res.status, { backendRequestId: parsed.error?.request_id, backendCode: contractCode });
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
        throw new BackendError("backend_unavailable", "Backend connection failed", 503);
      }
    }
    throw lastErr instanceof BackendError
      ? lastErr
      : new BackendError("backend_unavailable", "Exceeded max retries", 503);
  }

  private humanOnly(tool: string): Promise<never> {
    return Promise.reject(new BackendError(
      "human_only",
      `Tool ${tool} maps to an endpoint marked x-human-only in the OpenAPI contract. ` +
        `Service bearer tokens cannot invoke it; the operation must be performed by an authenticated human via the frontend.`,
      403,
    ));
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

  async getTask(_p: Principal, _taskId: string, projectId?:string): Promise<TaskDetail> {
    if(projectId) return this.getTaskScoped(_p, projectId, _taskId);
    // The contract requires projectId in the path. We expect taskId to be a UUID;
    // callers must supply projectId separately via list_project_tasks → get_task flow.
    // If a caller sends a bare UUID, we return not_found to force the correct flow.
    throw new BackendError(
      "validation_error",
      "get_task requires both projectId and taskId; use list_project_tasks first or pass '<projectId>/<taskId>' as the id. Backend path is /api/v1/projects/{projectId}/tasks/{taskId}.",
      400,
    );
  }

  // Added helper for callers that have both IDs (used by extended tooling).
  async getTaskScoped(p: Principal, projectId: string, taskId: string): Promise<TaskDetail> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      principal: p,
    });
    const dependencies=await this.request<{items:Array<{depends_on_id:string}>}>({method:"GET",path:`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dependencies`,principal:p});
    return {...fromContractTask(c, projectId),dependencies:dependencies.items.map(d=>d.depends_on_id)};
  }

  async getPlanVersion(p: Principal, planVersionId: string, projectId?:string): Promise<PlanVersion> {
    if(projectId) return this.getPlanScoped(p, projectId, planVersionId);
    throw new BackendError(
      "validation_error",
      "get_plan_version requires both projectId and planId in the contract: GET /api/v1/projects/{projectId}/plans/{planId}. Use get_plan_version(projectId, planVersionId).",
      400,
    );
  }

  async getPlanScoped(p: Principal, projectId: string, planId: string): Promise<PlanVersion> {
    const c = await this.request<ContractPlanResponse>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}`,
      principal: p,
    });
    return fromContractPlan(c);
  }

  async getCurrentPublishedPlan(p: Principal, projectId: string): Promise<PlanVersion | null> {
    const project = await this.getProject(p, projectId);
    if (!project.currentPlanVersionId) return null;
    return this.getPlanScoped(p, projectId, project.currentPlanVersionId);
  }

  async getProjectProgress(p: Principal, projectId: string): Promise<ProjectProgress> {
    const c = await this.request<any>({
      method: "GET",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`,
      principal: p,
    });
    const byStatus: Record<string, number> = c.by_status ?? c.task_counts_by_status ?? c.counts_by_status ?? {};
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

  async getApprovalStatus(p: Principal, planVersionId: string, projectId?:string): Promise<ApprovalStatus> {
    if(projectId) return this.getApprovalScoped(p, projectId, planVersionId);
    throw new BackendError(
      "validation_error",
      "Approval status is derived from GET /api/v1/projects/{projectId}/plans/{planId}; use get_plan_scoped and read planVersion.status. No dedicated backend operationId exists.",
      400,
    );
  }

  async getApprovalScoped(p: Principal, projectId: string, planId: string): Promise<ApprovalStatus> {
    const pv = await this.getPlanScoped(p, projectId, planId);
    const history = await this.request<any>({method:"GET",path:`/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/approvals`,principal:p});
    const approval = history.items.find((a:any)=>a.decision==='approved');
    const revoked = approval && history.revocations.some((r:any)=>r.approval_id===approval.id);
    return {planVersionId:pv.id,state:revoked?'expired':(pv.status==='approved'||pv.status==='published')&&approval?'approved':pv.status==='rejected'?'rejected':pv.status==='pending_approval'?'pending':'none',requestedBy:pv.createdBy,requestedAt:pv.createdAt,decidedBy:approval?.user_id??null,decidedAt:approval?.created_at??null,reason:revoked?'Approval permanently revoked':null};
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

  private async currentProjectVersion(p: Principal, projectId: string): Promise<number> {
    // Fetch the raw contract response to read `version` directly; our internal
    // ProjectDetail does not expose version by design (it is a backend-only
    // optimistic concurrency token).
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

  async createPlanDraft(p: Principal, input: CreatePlanDraftInput) {
    const base_project_version = input.baseProjectVersion ?? await this.currentProjectVersion(p, input.projectId);
    const c = await this.request<ContractPlanResponse>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/plans`,
      body: {
        base_project_version,
        snapshot: toContractSnapshot(input.plan),
      },
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      planVersion: fromContractPlan(c),
      operationId: c.id, // backend returns the plan version id; MCP exposes it as operation ref
    };
  }

  async proposePlanChanges(p: Principal, input: ProposePlanChangesInput) {
    const base_project_version = input.baseProjectVersion ?? await this.currentProjectVersion(p, input.projectId);
    const c = await this.request<ContractPlanResponse>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/change-proposals`,
      body: {
        base_project_version,
        snapshot: toContractSnapshot(input.plan),
        reason: input.rationale || "MCP plan revision",
      },
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      planVersion: fromContractPlan(c),
      operationId: c.id,
    };
  }

  async requestPlanApproval(_p: Principal, _input: RequestApprovalInput) {
    if(_input.projectId) return this.requestPlanApprovalScoped(_p,_input.projectId,_input.planVersionId,_input.idempotencyKey);
    throw new BackendError(
      "validation_error",
      "requestApproval requires both projectId and planVersionId. Use request_plan_approval(projectId, planVersionId).",
      400,
    );
  }

  async requestPlanApprovalScoped(p: Principal, projectId: string, planId: string, idempotencyKey: string) {
    const c = await this.request<ContractPlanResponse>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/request-approval`,
      principal: p,
      idempotencyKey,
    });
    const pv = fromContractPlan(c);
    return {
      approval: {
        planVersionId: pv.id,
        state: pv.status === "approved" ? "approved" : pv.status === "rejected" ? "rejected" : "pending",
        requestedBy: pv.createdBy,
        requestedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        reason: null,
      } as ApprovalStatus,
      operationId: pv.id,
    };
  }

  async publishApprovedPlan(_p: Principal, _input: PublishApprovedPlanInput) {
    if(_input.projectId && _input.contentHash) return this.publishApprovedPlanScoped(_p,_input.projectId,_input.planVersionId,_input.contentHash,_input.idempotencyKey);
    throw new BackendError(
      "validation_error",
      "publishPlan requires projectId, planId and content_hash. Use publish_approved_plan(projectId, planVersionId, contentHash).",
      400,
    );
  }

  async publishApprovedPlanScoped(p: Principal, projectId: string, planId: string, contentHash: string, idempotencyKey: string) {
    const c = await this.request<any>({
      method: "POST",
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/publish`,
      body: { content_hash: contentHash },
      principal: p,
      idempotencyKey,
    });
    // publishPlan returns an Operation shape (publish kind). The task IDs land in operation.result.task_ids once succeeded.
    const op = fromContractOperation(c);
    return {
      planVersion: await this.getPlanScoped(p, projectId, planId),
      publishedTaskIds: Array.isArray(c.result?.task_ids) ? c.result.task_ids : Object.values(c.result?.task_ids ?? {}) as string[],
      operationId: op.operationId,
    };
  }

  async updateTaskStatus(_p: Principal, _input: UpdateTaskStatusInput): Promise<never> {
    return this.humanOnly("update_task_status");
  }

  async listPlans(p:Principal,projectId:string) {
    const page=await this.request<{items:ContractPlanResponse[]}>({method:"GET",path:`/api/v1/projects/${encodeURIComponent(projectId)}/plans`,query:{limit:100,offset:0},principal:p});
    return page.items.map(fromContractPlan);
  }
  async submitReview(p:Principal,projectId:string,planId:string,key:string) {
    return this.request({method:"POST",path:`/api/v1/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/submit-review`,principal:p,idempotencyKey:key});
  }
  async storeAgentResult(p:Principal,input:{operationId:string;projectId:string;requestId:string;baseProjectVersion:number;payload:unknown;idempotencyKey:string}) {
    const op=await this.request<any>({method:"GET",path:`/api/v1/operations/${encodeURIComponent(input.operationId)}`,principal:p});
    if(op.project_id!==input.projectId || op.input.base_project_version!==input.baseProjectVersion) throw new BackendError("conflict","Operation provenance or original base mismatch",409);
    return this.request({method:"POST",path:`/api/v1/operations/${encodeURIComponent(input.operationId)}/result`,principal:{...p,correlationId:input.requestId},body:input.payload,idempotencyKey:input.idempotencyKey});
  }
  async proposeTaskMetadata(p:Principal,input:UpdateTaskInput) {
    if(!input.projectId) throw new BackendError("validation_error","projectId is required",400);
    const map:Record<string,string>={title:'title',description:'description',priority:'priority',assigneeId:'assignee_id',dueDate:'due_date',definitionOfDone:'definition_of_done',estimateHours:'estimated_effort'};
    const body:Record<string,unknown>={version:input.expectedVersion};
    for(const [key,value] of Object.entries(input.changes)) {
      if(!map[key]) throw new BackendError("validation_error",`Unsupported task proposal field: ${key}`,400);
      body[map[key]]=key==='priority'?toContractPriority(value as string):value;
    }
    const plan=await this.request<ContractPlanResponse>({method:"PATCH",path:`/api/v1/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.taskId)}`,body,principal:p,idempotencyKey:input.idempotencyKey});
    return {planVersion:fromContractPlan(plan),operationId:plan.id,requiresApproval:true};
  }
  async updateTask(_p: Principal, _input: UpdateTaskInput): Promise<never> {
    // taskMetadata is service-callable but it returns a new DRAFT PlanVersion.
    // Services MUST NOT treat the response as an applied edit — it still needs
    // human review and publication. We refuse here and expose a dedicated
    // `propose_task_metadata` tool in a follow-up.
    throw new BackendError(
      "validation_error",
      "update_task is deprecated: the taskMetadata endpoint returns a new draft PlanVersion that still requires human review and publication. Use the scoped update_task tool via the backend's `/plans/{planId}/submit-review` → `/request-approval` → human approval → `/publish` flow.",
      400,
    );
  }
}
