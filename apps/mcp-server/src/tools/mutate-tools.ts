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

const phase=z.object({key:z.string().min(1),name:z.string().min(1),description:z.string().optional()}).strict();
const task=z.object({key:z.string().min(1),phase_key:z.string().min(1),title:z.string().min(1),description:z.string().optional(),priority:z.enum(['low','medium','high','urgent']).optional(),assignee_id:z.string().uuid().nullable().optional(),start_date:z.string().nullable().optional(),due_date:z.string().nullable().optional(),estimated_effort:z.number().nullable().optional(),definition_of_done:z.string().optional(),depends_on:z.array(z.string())}).strict();
const planCreate=z.object({base_project_version:z.number().int().positive(),snapshot:z.object({phases:z.array(phase).min(1),tasks:z.array(task).min(1)}).strict()}).strict();
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
        baseProjectVersion: z.number().int().positive(),
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
        baseProjectVersion: z.number().int().positive(),
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
        projectId: StableIdSchema,
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
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        projectId: StableIdSchema,
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
      title: "Propose task metadata",
      description:
        "Create a new immutable draft proposal. Never modifies the published task; human approval and publication are required.",
      inputSchema: {
        projectId: StableIdSchema,
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
        planVersion: PlanVersionSchema,
        operationId: z.string(),
        requiresApproval: z.boolean(),
      },
    },
    async (args) => {
      try {
        return okText(await ctx.backend.proposeTaskMetadata!(ctx.getPrincipal(), args));
      } catch (e) {
        return errText(e);
      }
    },
  );
  server.registerTool("submit_review",{description:"Submit an immutable draft for review before requesting approval",inputSchema:{projectId:StableIdSchema,planVersionId:StableIdSchema,idempotencyKey:IdempotencyKey}},async a=>{try{return okText(await ctx.backend.submitReview!(ctx.getPrincipal(),a.projectId,a.planVersionId,a.idempotencyKey))}catch(e){return errText(e)}});
  server.registerTool("store_agent_result",{description:"Complete an existing planning operation using its original provenance and base; strict success/error union",inputSchema:{operationId:StableIdSchema,projectId:StableIdSchema,requestId:z.string().min(1),baseProjectVersion:z.number().int().positive(),idempotencyKey:IdempotencyKey,payload:z.union([z.object({result:planCreate}).strict(),z.object({error:z.string().min(1).max(2000)}).strict()])}},async a=>{try{return okText(await ctx.backend.storeAgentResult!(ctx.getPrincipal(),a))}catch(e){return errText(e)}});

}
