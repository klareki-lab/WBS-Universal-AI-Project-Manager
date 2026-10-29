import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "../backend/types.js";
import type { Principal } from "../schemas.js";
import {
  ActivityEntrySchema,
  ApprovalStatusSchema,
  OperationStatusSchema,
  PaginationInputSchema,
  PaginationOutputSchema,
  PlanVersionSchema,
  ProjectDetailSchema,
  ProjectProgressSchema,
  ProjectSummarySchema,
  StableIdSchema,
  TaskDetailSchema,
  TaskSummarySchema,
  TaskStatusSchema,
  PrioritySchema,
} from "../schemas.js";
import { errorToToolPayload } from "../errors.js";

type Ctx = { getPrincipal: () => Principal; backend: BackendClient };

function okText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }], structuredContent: obj as Record<string, unknown> };
}
function errText(err: unknown) {
  const payload = errorToToolPayload(err);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

export function registerReadTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Return projects visible to the authorized principal. Supports pagination and filtering.",
      inputSchema: PaginationInputSchema.extend({
        status: z.string().optional().describe("Filter by project status."),
        query: z.string().optional().describe("Case-insensitive substring match on project name."),
      }).shape,
      outputSchema: z.object({
        items: z.array(ProjectSummarySchema),
        nextCursor: z.string().nullable(),
        total: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async (args) => {
      try {
        return okText(await ctx.backend.listProjects(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Return project details by stable ID.",
      inputSchema: { id: StableIdSchema.describe("Project ID.") },
      outputSchema: ProjectDetailSchema.shape,
    },
    async ({ id }) => {
      try {
        return okText(await ctx.backend.getProject(ctx.getPrincipal(), id));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "list_project_tasks",
    {
      title: "List project tasks",
      description: "Return tasks for a project. Supports status, priority, phase filters and pagination.",
      inputSchema: PaginationInputSchema.extend({
        projectId: StableIdSchema,
        status: TaskStatusSchema.optional(),
        priority: PrioritySchema.optional(),
        phaseId: StableIdSchema.optional(),
      }).shape,
      outputSchema: z.object({
        items: z.array(TaskSummarySchema),
        nextCursor: z.string().nullable(),
        total: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async ({ projectId, ...filter }) => {
      try {
        return okText(await ctx.backend.listProjectTasks(ctx.getPrincipal(), projectId, filter));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description:
        "Return task details. Both projectId and taskId are required because the backend path is " +
        "GET /api/v1/projects/{projectId}/tasks/{taskId} and tasks are not globally addressable.",
      inputSchema: {
        projectId: StableIdSchema,
        taskId: StableIdSchema,
      },
      outputSchema: TaskDetailSchema.shape,
    },
    async ({ projectId, taskId }) => {
      try {
        return okText(await ctx.backend.getTask(ctx.getPrincipal(), projectId, taskId));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_plan_version",
    {
      title: "Get plan version",
      description:
        "Return a stored plan version with its ID, status, content hash and full snapshot. " +
        "Backend path: GET /api/v1/projects/{projectId}/plans/{planVersionId}.",
      inputSchema: {
        projectId: StableIdSchema,
        planVersionId: StableIdSchema,
      },
      outputSchema: PlanVersionSchema.shape,
    },
    async ({ projectId, planVersionId }) => {
      try {
        return okText(await ctx.backend.getPlanVersion(ctx.getPrincipal(), projectId, planVersionId));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_project_progress",
    {
      title: "Get project progress",
      description: "Return task counts, overdue work, blockers and completion ratio for a project.",
      inputSchema: { projectId: StableIdSchema },
      outputSchema: ProjectProgressSchema.shape,
    },
    async ({ projectId }) => {
      try {
        return okText(await ctx.backend.getProjectProgress(ctx.getPrincipal(), projectId));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_approval_status",
    {
      title: "Get approval status",
      description:
        "Return the approval state of a plan version. Distinguishes a real human decision (decidedBy / " +
        "decidedAt derived from the project activity log) from a derived state inferred from plan.status. " +
        "`reason` is `derived_from_plan_state` when the backend's audit log did not record a matching decision.",
      inputSchema: {
        projectId: StableIdSchema,
        planVersionId: StableIdSchema,
      },
      outputSchema: ApprovalStatusSchema.shape,
    },
    async ({ projectId, planVersionId }) => {
      try {
        return okText(await ctx.backend.getApprovalStatus(ctx.getPrincipal(), projectId, planVersionId));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "list_activity_history",
    {
      title: "List activity history",
      description: "Return authorized project activity (audit log) with pagination.",
      inputSchema: PaginationInputSchema.extend({ projectId: StableIdSchema }).shape,
      outputSchema: z.object({
        items: z.array(ActivityEntrySchema),
        nextCursor: z.string().nullable(),
        total: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async ({ projectId, cursor, limit }) => {
      try {
        return okText(await ctx.backend.listActivityHistory(ctx.getPrincipal(), projectId, cursor, limit));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_operation_status",
    {
      title: "Get operation status",
      description:
        "Return operation state and safe retry info. Use before retrying a mutation whose outcome is unknown. " +
        "operationId is globally unique (not project-scoped) in the backend contract.",
      inputSchema: { operationId: StableIdSchema },
      outputSchema: OperationStatusSchema.shape,
    },
    async ({ operationId }) => {
      try {
        return okText(await ctx.backend.getOperationStatus(ctx.getPrincipal(), operationId));
      } catch (e) {
        return errText(e);
      }
    },
  );
}

export const _schemaRefs = { PaginationOutputSchema };
