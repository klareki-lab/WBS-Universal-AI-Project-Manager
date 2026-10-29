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

const IdempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Must match ^[A-Za-z0-9_.:-]+$ per backend contract.")
  .describe("Caller-supplied unique key for idempotency (contract: 8–200 chars of [A-Za-z0-9_.:-]).");

const ContentHash = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Must be a lowercase hex SHA-256 (64 chars) matching the stored plan version.")
  .describe("Content hash of the plan version being published. Binds publication to the exact approved snapshot.");

export function registerMutateTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "create_project",
    {
      title: "Create project (human-only)",
      description:
        "The canonical operation is x-human-only in the OpenAPI contract. Services (bearer tokens) cannot " +
        "create projects — invoking this tool via a service identity returns `human_only` without hitting " +
        "the backend. Project creation is performed by an authenticated human in the frontend. The tool is " +
        "preserved in the catalog so clients can discover its policy and intended arguments.",
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
      description:
        "Save a structured draft plan. No publication, no approval request. Service scope: `plans:write`. " +
        "The backend reads the current project version internally and binds the plan to it; concurrent plan " +
        "mutations may surface `stale_version`.",
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
      description:
        "Create a new plan proposal/version via POST /api/v1/projects/{projectId}/change-proposals. " +
        "Never mutates an already approved plan snapshot — always writes a fresh plan version.",
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
      description:
        "Request human approval for a saved plan version. Backend path: POST " +
        "/api/v1/projects/{projectId}/plans/{planVersionId}/request-approval. If the plan is still in `draft` " +
        "state, the adapter automatically submits the review step first (POST /submit-review) using a derived " +
        "sub-idempotency key, matching the backend's required sequencing. Does NOT approve the plan — the " +
        "approval decision is a separate x-human-only call (`decidePlan`) performed in the frontend.",
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
        "Publish an existing human-approved plan version. Requires the service scope `plans:publish` AND a " +
        "prior human `decidePlan` approval binding the content_hash. Backend path: POST " +
        "/api/v1/projects/{projectId}/plans/{planVersionId}/publish. The `contentHash` argument binds the " +
        "publication to the exact approved snapshot — mismatched hash returns `conflict`.",
      inputSchema: {
        projectId: StableIdSchema,
        planVersionId: StableIdSchema,
        contentHash: ContentHash,
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        planVersion: PlanVersionSchema.nullable(),
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
      title: "Update task status (human-only)",
      description:
        "The backend's PATCH /api/v1/projects/{projectId}/tasks/{taskId}/status is x-human-only. Services " +
        "receive `human_only` and no network call is issued. Task status transitions are performed by an " +
        "authenticated human in the frontend. The tool remains in the catalog so clients see its contract shape.",
      inputSchema: {
        projectId: StableIdSchema,
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
      title: "Update task (proposal flow)",
      description:
        "Propose a task metadata change. Backend path: PATCH /api/v1/projects/{projectId}/tasks/{taskId}. " +
        "This endpoint does NOT apply the change in place — it writes a new DRAFT plan version carrying the " +
        "proposal (HTTP 201 taskMetadataResponse). The returned `proposedPlanVersion` must still be routed " +
        "through the approval + publication pipeline (`request_plan_approval` → human `decidePlan` → " +
        "`publish_approved_plan`) for the task change to take effect.",
      inputSchema: {
        projectId: StableIdSchema,
        taskId: StableIdSchema,
        expectedVersion: z.number().int().nonnegative(),
        changes: z
          .object({
            title: z.string().min(1).max(200).optional(),
            description: z.string().max(20000).optional(),
            priority: PrioritySchema.optional(),
            assigneeId: StableIdSchema.nullable().optional(),
            startDate: z.string().nullable().optional(),
            dueDate: z.string().nullable().optional(),
            definitionOfDone: z.string().max(20000).nullable().optional(),
            estimateHours: z.number().nonnegative().max(100000).nullable().optional(),
            tags: z.array(z.string().max(40)).max(20).optional(),
          })
          .refine((v) => Object.keys(v).length > 0, { message: "At least one change required" }),
        idempotencyKey: IdempotencyKey,
      },
      outputSchema: {
        proposedPlanVersion: PlanVersionSchema,
        operationId: z.string(),
        requiresApproval: z.literal(true),
        nextSteps: z.array(z.string()),
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
