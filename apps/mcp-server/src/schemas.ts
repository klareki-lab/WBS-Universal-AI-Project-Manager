import { z } from "zod";

export const StableIdSchema = z.string().min(1).max(128);

export const PaginationInputSchema = z.object({
  cursor: z.string().optional().describe("Opaque pagination cursor from a prior response. Decoded as `offset` against the backend."),
  limit: z.number().int().positive().max(100).optional().describe("Max items to return (contract max: 100)."),
});

export const PaginationOutputSchema = z.object({
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export const TaskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
]);

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const PlanStatusSchema = z.enum([
  "draft",
  "proposed",
  "pending_approval",
  "approved",
  "rejected",
  "published",
  "superseded",
]);

export const ApprovalStateSchema = z.enum(["none", "pending", "approved", "rejected", "expired"]);

export const OperationStateSchema = z.enum([
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ProjectSummarySchema = z.object({
  id: StableIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  domain: z.string().nullable(),
  ownerId: StableIdSchema.nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  tags: z.array(z.string()).default([]),
  phases: z.array(z.object({ id: StableIdSchema, name: z.string(), order: z.number().int() })).default([]),
  currentPlanVersionId: StableIdSchema.nullable(),
});

export const TaskSummarySchema = z.object({
  id: StableIdSchema,
  projectId: StableIdSchema,
  phaseId: StableIdSchema.nullable(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  assigneeId: StableIdSchema.nullable(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
});

export const TaskDetailSchema = TaskSummarySchema.extend({
  description: z.string().nullable(),
  dependencies: z.array(StableIdSchema).default([]),
  definitionOfDone: z.string().nullable(),
  estimateHours: z.number().nonnegative().nullable(),
  version: z.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
});

export const PlanTaskDraftSchema = z.object({
  tempId: z.string().min(1),
  phaseName: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: PrioritySchema.default("medium"),
  dependsOn: z.array(z.string()).default([]),
  estimateHours: z.number().nonnegative().optional(),
  definitionOfDone: z.string().optional(),
  owner: z.string().optional(),
  dueDate: z.string().optional(),
});

export const PlanDraftSchema = z.object({
  summary: z.string(),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  phases: z
    .array(
      z.object({
        name: z.string().min(1),
        order: z.number().int().nonnegative(),
        description: z.string().optional(),
      }),
    )
    .min(1),
  tasks: z.array(PlanTaskDraftSchema).min(1),
});

export const PlanVersionSchema = z.object({
  id: StableIdSchema,
  projectId: StableIdSchema,
  versionNumber: z.number().int().positive(),
  status: PlanStatusSchema,
  contentHash: z.string(),
  summary: z.string().nullable(),
  createdAt: z.string(),
  createdBy: StableIdSchema.nullable(),
  plan: PlanDraftSchema,
});

export const ProjectProgressSchema = z.object({
  projectId: StableIdSchema,
  counts: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.partialRecord(TaskStatusSchema, z.number().int().nonnegative()),
  }),
  overdue: z.number().int().nonnegative(),
  blockers: z.array(z.object({ taskId: StableIdSchema, reason: z.string() })).default([]),
  completionRatio: z.number().min(0).max(1),
  updatedAt: z.string(),
});

export const ApprovalStatusSchema = z.object({
  planVersionId: StableIdSchema,
  state: ApprovalStateSchema,
  requestedBy: StableIdSchema.nullable(),
  requestedAt: z.string().nullable(),
  decidedBy: StableIdSchema.nullable(),
  decidedAt: z.string().nullable(),
  reason: z.string().nullable(),
});

export const ActivityEntrySchema = z.object({
  id: StableIdSchema,
  projectId: StableIdSchema,
  actorId: StableIdSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: StableIdSchema.nullable(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const OperationStatusSchema = z.object({
  operationId: StableIdSchema,
  state: OperationStateSchema,
  action: z.string(),
  projectId: StableIdSchema.nullable(),
  idempotencyKey: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .default(null),
  resultRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PrincipalSchema = z.object({
  userId: StableIdSchema.optional(),
  serviceSubject: z.string().optional(),
  correlationId: z.string().optional(),
});

export type Principal = z.infer<typeof PrincipalSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type TaskSummary = z.infer<typeof TaskSummarySchema>;
export type TaskDetail = z.infer<typeof TaskDetailSchema>;
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
export type PlanVersion = z.infer<typeof PlanVersionSchema>;
export type ProjectProgress = z.infer<typeof ProjectProgressSchema>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
