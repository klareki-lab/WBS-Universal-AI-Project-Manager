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
        const page = await ctx.backend.listProjects(ctx.getPrincipal(), args);
        return okText(page);
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
      description: "Return task details by stable ID.",
      inputSchema: { id: StableIdSchema },
      outputSchema: TaskDetailSchema.shape,
    },
    async ({ id }) => {
      try {
        return okText(await ctx.backend.getTask(ctx.getPrincipal(), id));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_plan_version",
    {
      title: "Get plan version",
      description: "Return a stored plan version with its ID, status and content hash.",
      inputSchema: { id: StableIdSchema },
      outputSchema: PlanVersionSchema.shape,
    },
    async ({ id }) => {
      try {
        return okText(await ctx.backend.getPlanVersion(ctx.getPrincipal(), id));
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
      description: "Return the current approval state of a specific plan version.",
      inputSchema: { planVersionId: StableIdSchema },
      outputSchema: ApprovalStatusSchema.shape,
    },
    async ({ planVersionId }) => {
      try {
        return okText(await ctx.backend.getApprovalStatus(ctx.getPrincipal(), planVersionId));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "list_activity_history",
    {
      title: "List activity history",
      description: "Return authorized project activity with pagination.",
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
      description: "Return operation state and safe retry info. Use before retrying a mutation whose outcome is unknown.",
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

// Silence unused imports when type-stripping
export const _schemaRefs = { PaginationOutputSchema };
