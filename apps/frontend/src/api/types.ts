/** DRAFT interfaces, not an approved backend schema. No HTTP routes are assumed. */
export type ProjectType = 'it' | 'marketing' | 'operations' | 'event' | 'custom';
export type ProjectStatus = 'planning' | 'active' | 'at_risk' | 'completed' | 'draft' | 'on_hold' | 'archived';
export type PlanStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'superseded' | 'rejected';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type OperationState = 'queued' | 'running' | 'succeeded' | 'completed' | 'partial' | 'failed';
export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'revision_requested';
export interface User { id: string; displayName: string; }
export interface ProjectMember { projectId: string; userId: string; roleLabel: string; }
export interface Project { id: string; name: string; description: string; type: ProjectType; targetDate: string; budget?: number; constraints: string[]; status: ProjectStatus; progress: number; createdAt: string; activeDraftVersionId?: string; approvedPlanVersionId?: string; }
export interface Phase { id: string; title: string; description: string; order: number; }
export interface TaskDependency { taskId: string; predecessorTaskId: string; }
export interface Task { id: string; projectId?: string; phaseId: string; title: string; description: string; status: TaskStatus; priority: TaskPriority; estimateDays: number; dueDate?: string; dependsOn: string[]; assigneeId?: string; updatedAt?: string; }
export interface PlanWarning { id: string; severity: 'info' | 'warning' | 'critical'; title: string; detail: string; taskId?: string; }
/** Plan content (phases/tasks/warnings) is immutable once created; status is lifecycle metadata. */
export interface PlanVersion { id: string; projectId: string; version: number; status: PlanStatus; createdAt: string; source: 'demo-template' | 'user-edit' | 'demo-chat' | 'proposal' | 'revision'; phases: Phase[]; tasks: Task[]; warnings: PlanWarning[]; }
export interface Approval { id: string; projectId: string; planVersionId: string; approvedAt: string; approvedByLabel: string; simulated: boolean; }
export interface PlanChange { taskId: string; action: 'added' | 'modified' | 'removed'; before?: Task; after?: Task; }
export interface PlanDiff { projectId: string; baseVersionId?: string; candidateVersionId: string; changes: PlanChange[]; }
export interface ChangeProposal { id: string; projectId: string; basePlanVersionId: string; summary: string; suggestedTaskTitle: string; status: ProposalStatus; createdAt: string; source: 'local-demo-rule'; }
export interface ActivityEvent { id: string; projectId?: string; at: string; category: 'project' | 'task' | 'plan' | 'approval' | 'proposal' | 'operation'; title: string; detail: string; level: 'info' | 'success' | 'warning' | 'error'; simulated: boolean; }
export interface OperationJob { id: string; projectId: string; type: 'plan-analysis' | 'proposal-validation' | 'report-generation'; state: OperationState; createdAt: string; retrySafe: boolean; retryReason: string; simulated: true; detail: string; }
export interface AgentConversation { id: string; projectId: string; createdAt: string; messages: AgentMessage[]; }
export interface AgentMessage { id: string; role: 'user' | 'assistant'; text: string; kind: 'question' | 'read_only' | 'proposal'; createdAt: string; proposalId?: string; simulated: true; }
export interface AppCapabilities { mode: 'mock' | 'live'; persistence: boolean; aiAvailable: boolean; integrations: { name: string; connected: boolean; optional: true }[]; }
export interface NewProjectInput { name: string; description: string; type: ProjectType; targetDate: string; budget?: number; constraints: string[]; }
export type TaskEdit = Pick<Task, 'title' | 'description' | 'priority' | 'status' | 'estimateDays' | 'dueDate' | 'dependsOn'>;
export type OperationalTaskPatch = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'dependsOn' | 'assigneeId'>>;
export interface PlanningReply { message: string; generatedBy: 'local-demo-rule'; }
/** Swap mockApi for a future contract-approved adapter; backend enforces permissions and atomicity. */
export interface ProjectApi {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  createProject(input: NewProjectInput): Promise<{ project: Project; plan: PlanVersion }>;
  listTasks(projectId: string): Promise<Task[]>;
  updateTask(projectId: string, taskId: string, patch: OperationalTaskPatch): Promise<Task>;
  createTask(projectId: string, input: Pick<Task, 'title' | 'description' | 'priority' | 'dueDate'>): Promise<Task>;
  listMembers(projectId: string): Promise<User[]>;
  getPlan(versionId: string): Promise<PlanVersion>;
  listPlans(projectId: string): Promise<PlanVersion[]>;
  createDraftFromApproved(projectId: string): Promise<PlanVersion>;
  reviseTask(projectId: string, baseVersionId: string, taskId: string, patch: TaskEdit): Promise<PlanVersion>;
  addTaskFromDescription(projectId: string, baseVersionId: string, description: string): Promise<PlanVersion>;
  demoPlanningReply(message: string): Promise<PlanningReply>;
  diffPlan(projectId: string, candidateVersionId: string): Promise<PlanDiff>;
  approveVersion(projectId: string, versionId: string): Promise<Approval>;
  rejectVersion(projectId: string, versionId: string, reason: string): Promise<void>;
  requestRevision(projectId: string, versionId: string, note: string): Promise<PlanVersion>;
  listApprovals(projectId: string): Promise<Approval[]>;
  assistantMessage(projectId: string, text: string, intent: 'question' | 'propose'): Promise<AgentMessage>;
  listConversation(projectId: string): Promise<AgentConversation>;
  listProposals(projectId: string): Promise<ChangeProposal[]>;
  applyProposal(projectId: string, proposalId: string): Promise<PlanVersion>;
  rejectProposal(projectId: string, proposalId: string): Promise<void>;
  listOperations(projectId?: string): Promise<OperationJob[]>;
  listActivity(projectId?: string): Promise<ActivityEvent[]>;
  getCapabilities(): Promise<AppCapabilities>;
}
