import { createHash, randomUUID } from "node:crypto";
import { BackendError } from "../errors.js";
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
} from "../backend/types.js";
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
  TaskSummary,
} from "../schemas.js";

interface StoredApproval extends ApprovalStatus {}

interface StoredPlanVersion extends PlanVersion {
  publishedTaskIds: string[];
}

interface StoredProject extends ProjectDetail {
  memberIds: Set<string>;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["in_review", "blocked", "done", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  in_review: ["in_progress", "done"],
  done: [],
  cancelled: [],
};

const HIGH_IMPACT_FIELDS = new Set(["dueDate", "assigneeId", "priority"]);

function nowIso(): string {
  return new Date().toISOString();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashPlan(plan: PlanDraft): string {
  return sha(JSON.stringify(plan));
}

export class MockBackend implements BackendClient {
  readonly projects = new Map<string, StoredProject>();
  readonly tasks = new Map<string, TaskDetail>();
  readonly planVersions = new Map<string, StoredPlanVersion>();
  readonly approvals = new Map<string, StoredApproval>();
  readonly activity: ActivityEntry[] = [];
  readonly operations = new Map<string, OperationStatus>();
  readonly idempotency = new Map<string, string>(); // idempotencyKey -> operationId
  readonly rateLimitUntil = new Map<string, number>();

  constructor(seed = true) {
    if (seed) this.seedDemo();
  }

  private requireUser(principal: Principal): string {
    const userId = principal.userId ?? principal.serviceSubject;
    if (!userId) {
      throw new BackendError("unauthorized", "Missing principal identity", 401);
    }
    return userId;
  }

  private ensureProjectAccess(principal: Principal, projectId: string): StoredProject {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new BackendError("not_found", `Project ${projectId} not found`, 404);
    }
    const userId = this.requireUser(principal);
    if (principal.serviceSubject && !principal.userId) {
      // service-to-service: still require explicit user context
      throw new BackendError("forbidden", "Service calls must assert on-behalf-of userId", 403);
    }
    if (!project.memberIds.has(userId)) {
      throw new BackendError("forbidden", `User ${userId} has no access to project ${projectId}`, 403);
    }
    return project;
  }

  private registerIdempotency<T extends { operationId: string }>(key: string | undefined, build: () => T): T {
    if (!key) {
      throw new BackendError("validation_error", "idempotencyKey is required", 400);
    }
    const existingOp = this.idempotency.get(key);
    if (existingOp) {
      throw new BackendError(
        "idempotency_conflict",
        `Operation already recorded for idempotency key (operationId=${existingOp}); fetch its status before retrying`,
        409,
        { operationId: existingOp },
      );
    }
    const result = build();
    this.idempotency.set(key, result.operationId);
    return result;
  }

  private recordOperation(action: string, projectId: string | null, idempotencyKey: string | null, state: "succeeded" | "failed" = "succeeded", lastError: { code: string; message: string } | null = null): OperationStatus {
    const operationId = `op_${randomUUID()}`;
    const op: OperationStatus = {
      operationId,
      state,
      action,
      projectId,
      idempotencyKey,
      attempts: 1,
      lastError,
      resultRef: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.operations.set(operationId, op);
    return op;
  }

  private recordActivity(entry: Omit<ActivityEntry, "id" | "createdAt">): void {
    this.activity.push({ ...entry, id: `act_${randomUUID()}`, createdAt: nowIso() });
  }

  private paginate<T>(items: T[], cursor: string | undefined, limit: number | undefined): PageResult<T> {
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const slice = items.slice(offset, offset + take);
    const nextOffset = offset + slice.length;
    return {
      items: slice,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
      total: items.length,
    };
  }

  // ---------- Reads ----------
  async listProjects(principal: Principal, filter: ListProjectsFilter): Promise<PageResult<ProjectSummary>> {
    const userId = this.requireUser(principal);
    const list: ProjectSummary[] = [];
    for (const p of this.projects.values()) {
      if (!p.memberIds.has(userId)) continue;
      if (filter.status && p.status !== filter.status) continue;
      if (filter.query && !p.name.toLowerCase().includes(filter.query.toLowerCase())) continue;
      list.push({
        id: p.id,
        name: p.name,
        description: p.description,
        domain: p.domain,
        ownerId: p.ownerId,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
    return this.paginate(list, filter.cursor, filter.limit);
  }

  async getProject(principal: Principal, id: string): Promise<ProjectDetail> {
    const p = this.ensureProjectAccess(principal, id);
    const { memberIds: _m, ...detail } = p;
    return detail;
  }

  async listProjectTasks(principal: Principal, projectId: string, filter: ListTasksFilter): Promise<PageResult<TaskSummary>> {
    this.ensureProjectAccess(principal, projectId);
    const list: TaskSummary[] = [];
    for (const t of this.tasks.values()) {
      if (t.projectId !== projectId) continue;
      if (filter.status && t.status !== filter.status) continue;
      if (filter.priority && t.priority !== filter.priority) continue;
      if (filter.phaseId && t.phaseId !== filter.phaseId) continue;
      list.push({
        id: t.id,
        projectId: t.projectId,
        phaseId: t.phaseId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assigneeId,
        dueDate: t.dueDate,
        updatedAt: t.updatedAt,
      });
    }
    return this.paginate(list, filter.cursor, filter.limit);
  }

  async getTask(principal: Principal, projectId: string, taskId: string): Promise<TaskDetail> {
    const t = this.tasks.get(taskId);
    if (!t) throw new BackendError("not_found", `Task ${taskId} not found`, 404);
    if (t.projectId !== projectId) {
      throw new BackendError("not_found", `Task ${taskId} not found in project ${projectId}`, 404);
    }
    this.ensureProjectAccess(principal, projectId);
    return t;
  }

  async getPlanVersion(principal: Principal, projectId: string, planVersionId: string): Promise<PlanVersion> {
    const pv = this.planVersions.get(planVersionId);
    if (!pv) throw new BackendError("not_found", `Plan version ${planVersionId} not found`, 404);
    if (pv.projectId !== projectId) {
      throw new BackendError("not_found", `Plan version ${planVersionId} not found in project ${projectId}`, 404);
    }
    this.ensureProjectAccess(principal, projectId);
    const { publishedTaskIds: _p, ...rest } = pv;
    return rest;
  }

  async getCurrentPublishedPlan(principal: Principal, projectId: string): Promise<PlanVersion | null> {
    this.ensureProjectAccess(principal, projectId);
    let latest: StoredPlanVersion | null = null;
    for (const pv of this.planVersions.values()) {
      if (pv.projectId !== projectId) continue;
      if (pv.status !== "published") continue;
      if (!latest || pv.versionNumber > latest.versionNumber) latest = pv;
    }
    if (!latest) return null;
    const { publishedTaskIds: _p, ...rest } = latest;
    return rest;
  }

  async getProjectProgress(principal: Principal, projectId: string): Promise<ProjectProgress> {
    this.ensureProjectAccess(principal, projectId);
    const taskList = [...this.tasks.values()].filter((t) => t.projectId === projectId);
    const byStatus: Record<string, number> = {};
    let done = 0;
    let overdue = 0;
    const blockers: { taskId: string; reason: string }[] = [];
    const now = Date.now();
    for (const t of taskList) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.status === "done") done += 1;
      if (t.status === "blocked") blockers.push({ taskId: t.id, reason: "Blocked task" });
      if (t.dueDate && new Date(t.dueDate).getTime() < now && t.status !== "done" && t.status !== "cancelled") {
        overdue += 1;
      }
    }
    return {
      projectId,
      counts: { total: taskList.length, byStatus: byStatus as ProjectProgress["counts"]["byStatus"] },
      overdue,
      blockers,
      completionRatio: taskList.length === 0 ? 0 : done / taskList.length,
      updatedAt: nowIso(),
    };
  }

  async getApprovalStatus(principal: Principal, projectId: string, planVersionId: string): Promise<ApprovalStatus> {
    const pv = this.planVersions.get(planVersionId);
    if (!pv) throw new BackendError("not_found", `Plan version ${planVersionId} not found`, 404);
    if (pv.projectId !== projectId) {
      throw new BackendError("not_found", `Plan version ${planVersionId} not found in project ${projectId}`, 404);
    }
    this.ensureProjectAccess(principal, projectId);
    return (
      this.approvals.get(planVersionId) ?? {
        planVersionId,
        state: "none",
        requestedBy: null,
        requestedAt: null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
      }
    );
  }

  async listActivityHistory(principal: Principal, projectId: string, cursor?: string, limit?: number): Promise<PageResult<ActivityEntry>> {
    this.ensureProjectAccess(principal, projectId);
    const items = this.activity.filter((a) => a.projectId === projectId).slice().reverse();
    return this.paginate(items, cursor, limit);
  }

  async getOperationStatus(_principal: Principal, operationId: string): Promise<OperationStatus> {
    const op = this.operations.get(operationId);
    if (!op) throw new BackendError("not_found", `Operation ${operationId} not found`, 404);
    return op;
  }

  // ---------- Mutations ----------
  async createProject(principal: Principal, input: CreateProjectInput) {
    const userId = this.requireUser(principal);
    return this.registerIdempotency(input.idempotencyKey, () => {
      const id = `prj_${randomUUID()}`;
      const now = nowIso();
      const project: StoredProject = {
        id,
        name: input.name,
        description: input.description ?? null,
        domain: input.domain ?? null,
        ownerId: userId,
        status: "active",
        createdAt: now,
        updatedAt: now,
        tags: input.tags ?? [],
        phases: [],
        currentPlanVersionId: null,
        memberIds: new Set([userId]),
      };
      this.projects.set(id, project);
      const op = this.recordOperation("create_project", id, input.idempotencyKey);
      this.recordActivity({
        projectId: id,
        actorId: userId,
        action: "project.created",
        entityType: "project",
        entityId: id,
        metadata: { name: input.name },
      });
      const { memberIds: _m, ...detail } = project;
      return { project: detail, operationId: op.operationId };
    });
  }

  async createPlanDraft(principal: Principal, input: CreatePlanDraftInput) {
    const userId = this.requireUser(principal);
    this.ensureProjectAccess(principal, input.projectId);
    return this.registerIdempotency(input.idempotencyKey, () => {
      const id = `plv_${randomUUID()}`;
      const existing = [...this.planVersions.values()].filter((p) => p.projectId === input.projectId);
      const versionNumber = existing.length + 1;
      const pv: StoredPlanVersion = {
        id,
        projectId: input.projectId,
        versionNumber,
        status: "draft",
        contentHash: hashPlan(input.plan),
        summary: input.plan.summary,
        createdAt: nowIso(),
        createdBy: userId,
        plan: input.plan,
        publishedTaskIds: [],
      };
      this.planVersions.set(id, pv);
      const op = this.recordOperation("create_plan_draft", input.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: input.projectId,
        actorId: userId,
        action: "plan.draft_created",
        entityType: "plan_version",
        entityId: id,
        metadata: { versionNumber },
      });
      const { publishedTaskIds: _p, ...rest } = pv;
      return { planVersion: rest, operationId: op.operationId };
    });
  }

  async proposePlanChanges(principal: Principal, input: ProposePlanChangesInput) {
    const userId = this.requireUser(principal);
    this.ensureProjectAccess(principal, input.projectId);
    if (input.basePlanVersionId) {
      const base = this.planVersions.get(input.basePlanVersionId);
      if (!base) throw new BackendError("not_found", `Base plan ${input.basePlanVersionId} not found`, 404);
      if (base.status === "published" || base.status === "approved") {
        // allowed as a base reference, but we must never mutate it in place
      }
    }
    return this.registerIdempotency(input.idempotencyKey, () => {
      const id = `plv_${randomUUID()}`;
      const existing = [...this.planVersions.values()].filter((p) => p.projectId === input.projectId);
      const versionNumber = existing.length + 1;
      const pv: StoredPlanVersion = {
        id,
        projectId: input.projectId,
        versionNumber,
        status: "proposed",
        contentHash: hashPlan(input.plan),
        summary: input.plan.summary,
        createdAt: nowIso(),
        createdBy: userId,
        plan: input.plan,
        publishedTaskIds: [],
      };
      this.planVersions.set(id, pv);
      const op = this.recordOperation("propose_plan_changes", input.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: input.projectId,
        actorId: userId,
        action: "plan.proposed",
        entityType: "plan_version",
        entityId: id,
        metadata: { versionNumber, rationale: input.rationale ?? null },
      });
      const { publishedTaskIds: _p, ...rest } = pv;
      return { planVersion: rest, operationId: op.operationId };
    });
  }

  async requestPlanApproval(principal: Principal, input: RequestApprovalInput) {
    const userId = this.requireUser(principal);
    const pv = this.planVersions.get(input.planVersionId);
    if (!pv) throw new BackendError("not_found", `Plan version ${input.planVersionId} not found`, 404);
    if (pv.projectId !== input.projectId) {
      throw new BackendError("not_found", `Plan version ${input.planVersionId} not found in project ${input.projectId}`, 404);
    }
    this.ensureProjectAccess(principal, input.projectId);
    if (pv.status === "published") {
      throw new BackendError("conflict", "Plan already published", 409);
    }
    return this.registerIdempotency(input.idempotencyKey, () => {
      // Simulate the contract's submit-review → request-approval sequencing:
      // draft -> pending_approval (via the virtual submit-review step), then
      // record the approval request. This matches the HttpBackendClient flow.
      pv.status = "pending_approval";
      const approval: StoredApproval = {
        planVersionId: pv.id,
        state: "pending",
        requestedBy: userId,
        requestedAt: nowIso(),
        decidedBy: null,
        decidedAt: null,
        reason: input.note ?? null,
      };
      this.approvals.set(pv.id, approval);
      const op = this.recordOperation("request_plan_approval", pv.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: pv.projectId,
        actorId: userId,
        action: "plan.approval_requested",
        entityType: "plan_version",
        entityId: pv.id,
        metadata: {},
      });
      return { approval, operationId: op.operationId };
    });
  }

  // Test helper: simulate human approval. Agents cannot call this via MCP.
  approvePlanAsHuman(planVersionId: string, humanUserId: string, reason?: string): void {
    const pv = this.planVersions.get(planVersionId);
    if (!pv) throw new BackendError("not_found", `Plan version ${planVersionId} not found`, 404);
    const approval = this.approvals.get(planVersionId);
    if (!approval) throw new BackendError("conflict", "No pending approval request", 409);
    approval.state = "approved";
    approval.decidedBy = humanUserId;
    approval.decidedAt = nowIso();
    approval.reason = reason ?? approval.reason;
    pv.status = "approved";
  }

  async publishApprovedPlan(principal: Principal, input: PublishApprovedPlanInput) {
    const userId = this.requireUser(principal);
    const pv = this.planVersions.get(input.planVersionId);
    if (!pv) throw new BackendError("not_found", `Plan version ${input.planVersionId} not found`, 404);
    if (pv.projectId !== input.projectId) {
      throw new BackendError("not_found", `Plan version ${input.planVersionId} not found in project ${input.projectId}`, 404);
    }
    const project = this.ensureProjectAccess(principal, pv.projectId);
    if (pv.contentHash !== input.contentHash) {
      throw new BackendError(
        "conflict",
        "content_hash does not match the stored plan version — fetch the plan first",
        409,
      );
    }
    const approval = this.approvals.get(pv.id);
    if (!approval || approval.state !== "approved") {
      throw new BackendError("approval_required", "Plan version is not approved by a human", 403);
    }
    if (pv.status === "published") {
      throw new BackendError("conflict", "Plan version already published", 409);
    }
    if (pv.status !== "approved") {
      throw new BackendError("stale_version", `Plan version is in state ${pv.status}, cannot publish`, 409);
    }
    return this.registerIdempotency(input.idempotencyKey, () => {
      // supersede previous published version
      for (const other of this.planVersions.values()) {
        if (other.projectId === pv.projectId && other.status === "published" && other.id !== pv.id) {
          other.status = "superseded";
        }
      }
      pv.status = "published";
      project.currentPlanVersionId = pv.id;

      // materialize tasks
      const tempToId = new Map<string, string>();
      const now = nowIso();
      const phaseNameToId = new Map<string, string>();
      for (const phase of pv.plan.phases) {
        const phId = `phs_${randomUUID()}`;
        phaseNameToId.set(phase.name, phId);
        project.phases.push({ id: phId, name: phase.name, order: phase.order });
      }
      const createdTaskIds: string[] = [];
      for (const draft of pv.plan.tasks) {
        const taskId = `tsk_${randomUUID()}`;
        tempToId.set(draft.tempId, taskId);
        const task: TaskDetail = {
          id: taskId,
          projectId: pv.projectId,
          phaseId: phaseNameToId.get(draft.phaseName) ?? null,
          title: draft.title,
          description: draft.description ?? null,
          status: "todo",
          priority: draft.priority,
          assigneeId: null,
          dueDate: draft.dueDate ?? null,
          dependencies: [],
          definitionOfDone: draft.definitionOfDone ?? null,
          estimateHours: draft.estimateHours ?? null,
          version: 1,
          tags: [],
          updatedAt: now,
        };
        this.tasks.set(taskId, task);
        createdTaskIds.push(taskId);
      }
      // resolve dependencies after all task IDs exist
      for (const draft of pv.plan.tasks) {
        const taskId = tempToId.get(draft.tempId)!;
        const task = this.tasks.get(taskId)!;
        task.dependencies = draft.dependsOn
          .map((d) => tempToId.get(d))
          .filter((v): v is string => Boolean(v));
      }
      pv.publishedTaskIds = createdTaskIds;

      const op = this.recordOperation("publish_approved_plan", pv.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: pv.projectId,
        actorId: userId,
        action: "plan.published",
        entityType: "plan_version",
        entityId: pv.id,
        metadata: { taskCount: createdTaskIds.length },
      });
      const { publishedTaskIds, ...rest } = pv;
      return { planVersion: rest, publishedTaskIds, operationId: op.operationId };
    });
  }

  async updateTaskStatus(principal: Principal, input: UpdateTaskStatusInput) {
    const userId = this.requireUser(principal);
    const task = this.tasks.get(input.taskId);
    if (!task) throw new BackendError("not_found", `Task ${input.taskId} not found`, 404);
    if (task.projectId !== input.projectId) {
      throw new BackendError("not_found", `Task ${input.taskId} not found in project ${input.projectId}`, 404);
    }
    this.ensureProjectAccess(principal, input.projectId);
    if (task.version !== input.expectedVersion) {
      throw new BackendError("stale_version", `Task version mismatch (have ${task.version}, got ${input.expectedVersion})`, 409);
    }
    const allowed = VALID_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new BackendError(
        "validation_error",
        `Invalid status transition ${task.status} -> ${input.status}`,
        400,
      );
    }
    return this.registerIdempotency(input.idempotencyKey, () => {
      task.status = input.status as TaskDetail["status"];
      task.version += 1;
      task.updatedAt = nowIso();
      const op = this.recordOperation("update_task_status", task.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: task.projectId,
        actorId: userId,
        action: "task.status_updated",
        entityType: "task",
        entityId: task.id,
        metadata: { to: input.status, reason: input.reason ?? null },
      });
      return { task, operationId: op.operationId };
    });
  }

  /**
   * Contract-aligned semantics: taskMetadata produces a new draft PlanVersion
   * carrying the proposed change. The task itself is NOT updated in place.
   */
  async updateTask(principal: Principal, input: UpdateTaskInput): Promise<UpdateTaskResult> {
    const userId = this.requireUser(principal);
    const task = this.tasks.get(input.taskId);
    if (!task) throw new BackendError("not_found", `Task ${input.taskId} not found`, 404);
    if (task.projectId !== input.projectId) {
      throw new BackendError("not_found", `Task ${input.taskId} not found in project ${input.projectId}`, 404);
    }
    this.ensureProjectAccess(principal, input.projectId);
    if (task.version !== input.expectedVersion) {
      throw new BackendError("stale_version", `Task version mismatch (have ${task.version}, got ${input.expectedVersion})`, 409);
    }
    return this.registerIdempotency(input.idempotencyKey, () => {
      // Build a proposal plan that mirrors the project's current task set
      // but applies the requested metadata change to this task.
      const existingTasks = [...this.tasks.values()].filter((t) => t.projectId === input.projectId);
      const project = this.projects.get(input.projectId)!;
      const phases = project.phases.length
        ? project.phases.map((ph) => ({ name: ph.name, order: ph.order, description: undefined as string | undefined }))
        : [{ name: "Default", order: 0, description: undefined as string | undefined }];
      const planTasks = existingTasks.map((t) => ({
        tempId: t.id,
        phaseName: project.phases.find((ph) => ph.id === t.phaseId)?.name ?? phases[0]!.name,
        title: t.id === task.id ? input.changes.title ?? t.title : t.title,
        description: t.id === task.id && input.changes.description !== undefined ? input.changes.description : t.description ?? undefined,
        priority: (t.id === task.id && input.changes.priority !== undefined ? input.changes.priority : t.priority) as "low" | "medium" | "high" | "critical",
        dependsOn: t.dependencies,
        estimateHours: t.id === task.id && input.changes.estimateHours !== undefined ? input.changes.estimateHours ?? undefined : t.estimateHours ?? undefined,
        definitionOfDone: t.id === task.id && input.changes.definitionOfDone !== undefined ? input.changes.definitionOfDone ?? undefined : t.definitionOfDone ?? undefined,
        dueDate: t.id === task.id && input.changes.dueDate !== undefined ? input.changes.dueDate ?? undefined : t.dueDate ?? undefined,
      }));
      const planDraft: PlanDraft = {
        summary: `Metadata change for task ${task.id}`,
        assumptions: [],
        risks: [],
        phases,
        tasks: planTasks,
      };
      const id = `plv_${randomUUID()}`;
      const existing = [...this.planVersions.values()].filter((pv) => pv.projectId === input.projectId);
      const versionNumber = existing.length + 1;
      const pv: StoredPlanVersion = {
        id,
        projectId: input.projectId,
        versionNumber,
        status: "draft",
        contentHash: hashPlan(planDraft),
        summary: planDraft.summary,
        createdAt: nowIso(),
        createdBy: userId,
        plan: planDraft,
        publishedTaskIds: [],
      };
      this.planVersions.set(id, pv);
      const op = this.recordOperation("update_task.metadata_proposed", input.projectId, input.idempotencyKey);
      this.recordActivity({
        projectId: input.projectId,
        actorId: userId,
        action: "plan.draft_created",
        entityType: "plan_version",
        entityId: id,
        metadata: { reason: "taskMetadata proposal", taskId: task.id, fields: Object.keys(input.changes) },
      });
      const { publishedTaskIds: _p, ...rest } = pv;
      return {
        proposedPlanVersion: rest,
        operationId: op.operationId,
        requiresApproval: true as const,
        nextSteps: [
          "request_plan_approval(projectId, planVersionId)",
          "wait for human decidePlan (frontend)",
          "publish_approved_plan(projectId, planVersionId, contentHash) — requires plans:publish",
        ],
      };
    });
  }

  // ---------- Demo seed ----------
  private seedDemo() {
    const now = nowIso();
    const project: StoredProject = {
      id: "prj_demo",
      name: "Demo project",
      description: "Seeded demo project for local MCP testing.",
      domain: "software",
      ownerId: "user_demo",
      status: "active",
      createdAt: now,
      updatedAt: now,
      tags: ["demo"],
      phases: [{ id: "phs_demo_1", name: "Discovery", order: 0 }],
      currentPlanVersionId: null,
      memberIds: new Set(["user_demo", "user_alice"]),
    };
    this.projects.set(project.id, project);

    const task: TaskDetail = {
      id: "tsk_demo_1",
      projectId: "prj_demo",
      phaseId: "phs_demo_1",
      title: "Interview stakeholders",
      description: "Conduct discovery interviews.",
      status: "todo",
      priority: "medium",
      assigneeId: null,
      dueDate: null,
      dependencies: [],
      definitionOfDone: "Interview notes stored in shared folder.",
      estimateHours: 8,
      version: 1,
      tags: [],
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
  }
}
