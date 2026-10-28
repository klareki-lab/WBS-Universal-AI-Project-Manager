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
  PlanVersion,
  Principal,
  ProjectDetail,
  ProjectProgress,
  ProjectSummary,
  TaskDetail,
  TaskSummary,
} from "../schemas.js";

interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
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
  422: "validation_error",
  429: "rate_limited",
  502: "backend_unavailable",
  503: "backend_unavailable",
  504: "timeout",
};

export class HttpBackendClient implements BackendClient {
  constructor(private readonly cfg: Config) {}

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(opts.path, this.cfg.backendBaseUrl!);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "x-service-token": this.cfg.backendServiceToken ?? "",
    });
    if (opts.principal.userId) headers.set("x-on-behalf-of", opts.principal.userId);
    if (opts.principal.correlationId) headers.set("x-correlation-id", opts.principal.correlationId);
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
        const text = await res.text().catch(() => "");
        const code = STATUS_TO_CODE[res.status] ?? "internal_error";
        if (RETRY_STATUSES.has(res.status) && attempt <= this.cfg.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after")) || Math.min(2 ** attempt * 100, 2000);
          logger.warn({ status: res.status, retryAfter, attempt }, "backend retry");
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        throw new BackendError(code, `Backend ${res.status}: ${text.slice(0, 300)}`, res.status);
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
    throw (lastErr instanceof BackendError
      ? lastErr
      : new BackendError("backend_unavailable", "Exceeded max retries", 503));
  }

  listProjects(p: Principal, f: ListProjectsFilter): Promise<PageResult<ProjectSummary>> {
    return this.request({ method: "GET", path: "/v1/projects", query: f as any, principal: p });
  }
  getProject(p: Principal, id: string): Promise<ProjectDetail> {
    return this.request({ method: "GET", path: `/v1/projects/${encodeURIComponent(id)}`, principal: p });
  }
  listProjectTasks(p: Principal, projectId: string, f: ListTasksFilter): Promise<PageResult<TaskSummary>> {
    return this.request({ method: "GET", path: `/v1/projects/${encodeURIComponent(projectId)}/tasks`, query: f as any, principal: p });
  }
  getTask(p: Principal, id: string): Promise<TaskDetail> {
    return this.request({ method: "GET", path: `/v1/tasks/${encodeURIComponent(id)}`, principal: p });
  }
  getPlanVersion(p: Principal, id: string): Promise<PlanVersion> {
    return this.request({ method: "GET", path: `/v1/plan-versions/${encodeURIComponent(id)}`, principal: p });
  }
  getCurrentPublishedPlan(p: Principal, projectId: string): Promise<PlanVersion | null> {
    return this.request({ method: "GET", path: `/v1/projects/${encodeURIComponent(projectId)}/plan/current`, principal: p });
  }
  getProjectProgress(p: Principal, projectId: string): Promise<ProjectProgress> {
    return this.request({ method: "GET", path: `/v1/projects/${encodeURIComponent(projectId)}/progress`, principal: p });
  }
  getApprovalStatus(p: Principal, planVersionId: string): Promise<ApprovalStatus> {
    return this.request({ method: "GET", path: `/v1/plan-versions/${encodeURIComponent(planVersionId)}/approval`, principal: p });
  }
  listActivityHistory(p: Principal, projectId: string, cursor?: string, limit?: number): Promise<PageResult<ActivityEntry>> {
    return this.request({ method: "GET", path: `/v1/projects/${encodeURIComponent(projectId)}/activity`, query: { cursor, limit }, principal: p });
  }
  getOperationStatus(p: Principal, operationId: string): Promise<OperationStatus> {
    return this.request({ method: "GET", path: `/v1/operations/${encodeURIComponent(operationId)}`, principal: p });
  }
  createProject(p: Principal, input: CreateProjectInput) {
    return this.request<{ project: ProjectDetail; operationId: string }>({
      method: "POST",
      path: "/v1/projects",
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  createPlanDraft(p: Principal, input: CreatePlanDraftInput) {
    return this.request<{ planVersion: PlanVersion; operationId: string }>({
      method: "POST",
      path: `/v1/projects/${encodeURIComponent(input.projectId)}/plan-drafts`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  proposePlanChanges(p: Principal, input: ProposePlanChangesInput) {
    return this.request<{ planVersion: PlanVersion; operationId: string }>({
      method: "POST",
      path: `/v1/projects/${encodeURIComponent(input.projectId)}/plan-proposals`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  requestPlanApproval(p: Principal, input: RequestApprovalInput) {
    return this.request<{ approval: ApprovalStatus; operationId: string }>({
      method: "POST",
      path: `/v1/plan-versions/${encodeURIComponent(input.planVersionId)}/approval-requests`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  publishApprovedPlan(p: Principal, input: PublishApprovedPlanInput) {
    return this.request<{ planVersion: PlanVersion; publishedTaskIds: string[]; operationId: string }>({
      method: "POST",
      path: `/v1/plan-versions/${encodeURIComponent(input.planVersionId)}/publish`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  updateTaskStatus(p: Principal, input: UpdateTaskStatusInput) {
    return this.request<{ task: TaskDetail; operationId: string }>({
      method: "POST",
      path: `/v1/tasks/${encodeURIComponent(input.taskId)}/status`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
  updateTask(p: Principal, input: UpdateTaskInput) {
    return this.request<{ task: TaskDetail; operationId: string; requiresApproval: boolean }>({
      method: "PATCH",
      path: `/v1/tasks/${encodeURIComponent(input.taskId)}`,
      body: input,
      principal: p,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
