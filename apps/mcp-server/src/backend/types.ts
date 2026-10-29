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

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface ListProjectsFilter {
  cursor?: string;
  limit?: number;
  status?: string;
  query?: string;
}

export interface ListTasksFilter {
  cursor?: string;
  limit?: number;
  status?: string;
  priority?: string;
  phaseId?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  domain?: string;
  tags?: string[];
  idempotencyKey: string;
}

export interface CreatePlanDraftInput {
  projectId: string;
  plan: PlanDraft;
  idempotencyKey: string;
}

export interface ProposePlanChangesInput {
  projectId: string;
  basePlanVersionId: string | null;
  plan: PlanDraft;
  rationale?: string;
  idempotencyKey: string;
}

export interface RequestApprovalInput {
  projectId: string;
  planVersionId: string;
  note?: string;
  idempotencyKey: string;
}

export interface PublishApprovedPlanInput {
  projectId: string;
  planVersionId: string;
  contentHash: string;
  idempotencyKey: string;
}

export interface UpdateTaskStatusInput {
  projectId: string;
  taskId: string;
  expectedVersion: number;
  status: string;
  reason?: string;
  idempotencyKey: string;
}

export interface UpdateTaskInput {
  projectId: string;
  taskId: string;
  expectedVersion: number;
  changes: Partial<{
    title: string;
    description: string;
    priority: string;
    assigneeId: string | null;
    dueDate: string | null;
    startDate: string | null;
    definitionOfDone: string | null;
    estimateHours: number | null;
    tags: string[];
  }>;
  idempotencyKey: string;
}

/**
 * Return value from `update_task`.
 *
 * The backend's `taskMetadata` endpoint does NOT apply the change in-place;
 * it writes a new DRAFT plan version containing the proposed task
 * modification. The caller must then route that plan version through the
 * approval + publication flow (`submit_review` / `request_plan_approval`
 * / human `decidePlan` / `publish_approved_plan`) for the change to take
 * effect on live tasks.
 */
export interface UpdateTaskResult {
  proposedPlanVersion: PlanVersion;
  operationId: string;
  requiresApproval: true;
  nextSteps: string[];
}

export interface BackendClient {
  listProjects(principal: Principal, filter: ListProjectsFilter): Promise<PageResult<ProjectSummary>>;
  getProject(principal: Principal, id: string): Promise<ProjectDetail>;
  listProjectTasks(principal: Principal, projectId: string, filter: ListTasksFilter): Promise<PageResult<TaskSummary>>;
  getTask(principal: Principal, projectId: string, taskId: string): Promise<TaskDetail>;
  getPlanVersion(principal: Principal, projectId: string, planVersionId: string): Promise<PlanVersion>;
  getCurrentPublishedPlan(principal: Principal, projectId: string): Promise<PlanVersion | null>;
  getProjectProgress(principal: Principal, projectId: string): Promise<ProjectProgress>;
  getApprovalStatus(principal: Principal, projectId: string, planVersionId: string): Promise<ApprovalStatus>;
  listActivityHistory(principal: Principal, projectId: string, cursor?: string, limit?: number): Promise<PageResult<ActivityEntry>>;
  getOperationStatus(principal: Principal, operationId: string): Promise<OperationStatus>;
  createProject(principal: Principal, input: CreateProjectInput): Promise<{ project: ProjectDetail; operationId: string }>;
  createPlanDraft(principal: Principal, input: CreatePlanDraftInput): Promise<{ planVersion: PlanVersion; operationId: string }>;
  proposePlanChanges(principal: Principal, input: ProposePlanChangesInput): Promise<{ planVersion: PlanVersion; operationId: string }>;
  requestPlanApproval(principal: Principal, input: RequestApprovalInput): Promise<{ approval: ApprovalStatus; operationId: string }>;
  publishApprovedPlan(principal: Principal, input: PublishApprovedPlanInput): Promise<{ planVersion: PlanVersion | null; publishedTaskIds: string[]; operationId: string }>;
  updateTaskStatus(principal: Principal, input: UpdateTaskStatusInput): Promise<{ task: TaskDetail; operationId: string }>;
  updateTask(principal: Principal, input: UpdateTaskInput): Promise<UpdateTaskResult>;
}
