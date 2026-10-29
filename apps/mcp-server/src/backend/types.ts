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
  baseProjectVersion?: number;
  idempotencyKey: string;
}

export interface ProposePlanChangesInput {
  projectId: string;
  basePlanVersionId: string | null;
  plan: PlanDraft;
  baseProjectVersion?: number;
  rationale?: string;
  idempotencyKey: string;
}

export interface RequestApprovalInput {
  projectId?: string;
  planVersionId: string;
  note?: string;
  idempotencyKey: string;
}

export interface PublishApprovedPlanInput {
  projectId?: string;
  contentHash?: string;
  planVersionId: string;
  idempotencyKey: string;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  expectedVersion: number;
  status: string;
  reason?: string;
  idempotencyKey: string;
}

export interface UpdateTaskInput {
  projectId?: string;
  taskId: string;
  expectedVersion: number;
  changes: Partial<{
    title: string;
    description: string;
    priority: string;
    assigneeId: string | null;
    dueDate: string | null;
    definitionOfDone: string | null;
    estimateHours: number | null;
    tags: string[];
  }>;
  idempotencyKey: string;
}

export interface BackendClient {
  submitReview?(principal: Principal, projectId: string, planId: string, key: string): Promise<unknown>;
  storeAgentResult?(principal: Principal, input: {operationId:string;projectId:string;requestId:string;baseProjectVersion:number;payload:unknown;idempotencyKey:string}): Promise<unknown>;
  proposeTaskMetadata?(principal: Principal, input: UpdateTaskInput): Promise<{planVersion:PlanVersion;operationId:string;requiresApproval:boolean}>;
  listPlans?(principal: Principal, projectId: string): Promise<PlanVersion[]>;
  listProjects(principal: Principal, filter: ListProjectsFilter): Promise<PageResult<ProjectSummary>>;
  getProject(principal: Principal, id: string): Promise<ProjectDetail>;
  listProjectTasks(principal: Principal, projectId: string, filter: ListTasksFilter): Promise<PageResult<TaskSummary>>;
  getTask(principal: Principal, taskId: string, projectId?: string): Promise<TaskDetail>;
  getPlanVersion(principal: Principal, planVersionId: string, projectId?: string): Promise<PlanVersion>;
  getCurrentPublishedPlan(principal: Principal, projectId: string): Promise<PlanVersion | null>;
  getProjectProgress(principal: Principal, projectId: string): Promise<ProjectProgress>;
  getApprovalStatus(principal: Principal, planVersionId: string, projectId?: string): Promise<ApprovalStatus>;
  listActivityHistory(principal: Principal, projectId: string, cursor?: string, limit?: number): Promise<PageResult<ActivityEntry>>;
  getOperationStatus(principal: Principal, operationId: string): Promise<OperationStatus>;
  createProject(principal: Principal, input: CreateProjectInput): Promise<{ project: ProjectDetail; operationId: string }>;
  createPlanDraft(principal: Principal, input: CreatePlanDraftInput): Promise<{ planVersion: PlanVersion; operationId: string }>;
  proposePlanChanges(principal: Principal, input: ProposePlanChangesInput): Promise<{ planVersion: PlanVersion; operationId: string }>;
  requestPlanApproval(principal: Principal, input: RequestApprovalInput): Promise<{ approval: ApprovalStatus; operationId: string }>;
  publishApprovedPlan(principal: Principal, input: PublishApprovedPlanInput): Promise<{ planVersion: PlanVersion; publishedTaskIds: string[]; operationId: string }>;
  updateTaskStatus(principal: Principal, input: UpdateTaskStatusInput): Promise<{ task: TaskDetail; operationId: string }>;
  updateTask(principal: Principal, input: UpdateTaskInput): Promise<{ task: TaskDetail; operationId: string; requiresApproval: boolean }>;
}
