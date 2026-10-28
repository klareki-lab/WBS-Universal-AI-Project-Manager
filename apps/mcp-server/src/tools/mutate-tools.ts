import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "../backend/types.js";
import type { Principal } from "../schemas.js";
import {
  ApprovalStatusSchema,
  PlanDraftSchema,
  PlanVersionSchema,
  PrioritySchema,
  ProjectDetailSchema,
  StableIdSchema,
  TaskDetailSchema,
  TaskStatusSchema,
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

const IdempotencyKey = z.string().min(8).max(128).describe("Caller-supplied unique key for idempotency.");

export function registerMutateTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create a project with validated metadata and an idempotency key. The backend enforces authorization.",
      inputSchema: {
        name: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        domain: z.string().max(100).optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        project: ProjectDetailSchema,
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.createProject(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "create_plan_draft",
    {
      title: "Create plan draft",
      description: "Save a structured draft plan. Does not publish live tasks and does not request approval.",
      inputSchema: {
        projectId: StableIdSchema,
        plan: PlanDraftSchema,
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        planVersion: PlanVersionSchema,
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.createPlanDraft(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "propose_plan_changes",
    {
      title: "Propose plan changes",
      description: "Create a new plan proposal/version. Never mutates an already approved plan snapshot.",
      inputSchema: {
        projectId: StableIdSchema,
        basePlanVersionId: StableIdSchema.nullable().describe("Prior plan version this proposal is based on, if any."),
        plan: PlanDraftSchema,
        rationale: z.string().max(5000).optional(),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        planVersion: PlanVersionSchema,
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.proposePlanChanges(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "request_plan_approval",
    {
      title: "Request plan approval",
      description: "Create a pending human approval request for a saved plan version. Does NOT approve the plan.",
      inputSchema: {
        planVersionId: StableIdSchema,
        note: z.string().max(2000).optional(),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        approval: ApprovalStatusSchema,
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.requestPlanApproval(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "publish_approved_plan",
    {
      title: "Publish approved plan",
      description:
        "Publish an existing approved plan version. The backend independently validates human approval, version hash, authorization and idempotency.",
      inputSchema: {
        planVersionId: StableIdSchema,
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        planVersion: PlanVersionSchema,
        publishedTaskIds: z.array(StableIdSchema),
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.publishApprovedPlan(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "update_task_status",
    {
      title: "Update task status",
      description: "Change task status under backend-enforced permissions and approval policy. Rejects invalid transitions and stale versions.",
      inputSchema: {
        taskId: StableIdSchema,
        expectedVersion: z.number().int().nonnegative(),
        status: TaskStatusSchema,
        reason: z.string().max(2000).optional(),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        task: TaskDetailSchema,
        operationId: z.string(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.updateTaskStatus(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Propose or apply allowed task field changes according to backend policy. High-impact changes (priority, assigneeId, dueDate) require a separate approved plan proposal.",
      inputSchema: {
        taskId: StableIdSchema,
        expectedVersion: z.number().int().nonnegative(),
        changes: z
          .object({
            title: z.string().min(1).max(500).optional(),
            description: z.string().max(5000).optional(),
            priority: PrioritySchema.optional(),
            assigneeId: StableIdSchema.nullable().optional(),
            dueDate: z.string().nullable().optional(),
            definitionOfDone: z.string().max(2000).nullable().optional(),
            estimateHours: z.number().nonnegative().nullable().optional(),
            tags: z.array(z.string().max(40)).max(20).optional(),
          })
          .refine((v) => Object.keys(v).length > 0, { message: "At least one change required" }),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        task: TaskDetailSchema,
        operationId: z.string(),
        requiresApproval: z.boolean(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.updateTask(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );
}
