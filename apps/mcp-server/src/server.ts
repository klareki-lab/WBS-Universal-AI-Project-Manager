import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { BackendClient } from "./backend/types.js";
import type { Config } from "./config.js";
import { logger, withCorrelation } from "./logger.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerMutateTools } from "./tools/mutate-tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import type { Principal } from "./schemas.js";

interface RequestContext {
  principal: Principal;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

function parsePrincipal(req: Request, serviceToken: string): Principal {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.header("x-service-token") ?? "";
  const correlationId = req.header("x-correlation-id") ?? randomUUID();
  if (token !== serviceToken) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
  const userId = req.header("x-on-behalf-of") ?? undefined;
  const serviceSubject = req.header("x-service-subject") ?? "uapm-mcp-client";
  return { userId, serviceSubject, correlationId };
}

export function buildMcpServer(backend: BackendClient): McpServer {
  const server = new McpServer(
    { name: "uapm-mcp", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
      instructions:
        "Universal AI Project Manager MCP server. All mutations require idempotency keys and are policy-enforced by the backend. Human approval is required for publication. Agents cannot approve on behalf of users.",
    },
  );

  const getPrincipal = (): Principal => {
    const ctx = requestContext.getStore();
    if (!ctx) throw new Error("No request context (principal) available");
    return ctx.principal;
  };

  const toolCtx = { getPrincipal, backend };
  registerReadTools(server, toolCtx);
  registerMutateTools(server, toolCtx);
  registerResources(server, toolCtx);
  registerPrompts(server);

  return server;
}

export function buildHttpApp(cfg: Config, backend: BackendClient) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.disable("x-powered-by");

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", service: "uapm-mcp", version: "0.1.0" });
  });

  const handleMcp = async (req: Request, res: Response) => {
    let principal: Principal;
    try {
      principal = parsePrincipal(req, cfg.mcpServiceToken);
    } catch (e: any) {
      logger.warn({ status: e.status ?? 401 }, "rejected unauthenticated MCP request");
      res.status(401).json({ error: { code: "unauthorized", message: "Missing or invalid service token" } });
      return;
    }

    const log = withCorrelation(principal.correlationId!);
    const sessionIdHeader = req.header("mcp-session-id");

    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionIdHeader && transports.has(sessionIdHeader)) {
        transport = transports.get(sessionIdHeader);
      } else if (!sessionIdHeader && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport!);
            log.info({ sessionId: sid }, "MCP session initialized");
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) {
            transports.delete(transport.sessionId);
            log.info({ sessionId: transport.sessionId }, "MCP session closed");
          }
        };
        const server = buildMcpServer(backend);
        await server.connect(transport);
      } else {
        res.status(400).json({ error: { code: "bad_request", message: "No session; call initialize first" } });
        return;
      }
      await requestContext.run({ principal }, async () => {
        await transport!.handleRequest(req, res, req.body);
      });
    } catch (err: any) {
      log.error({ err: err?.message }, "MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({ error: { code: "internal_error", message: String(err?.message ?? err) } });
      }
    }
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  // --- REST invocation facade for deterministic HTTP callers (n8n webhooks).
  //
  // This path bypasses the MCP Streamable HTTP session negotiation so that
  // deterministic workflow engines (which do not speak MCP) can still invoke
  // read + write tools through a single, policy-enforced server-side surface.
  // It uses the same service-token authentication, principal headers, and
  // backend adapter as the MCP route — all policy guards (`human_only`,
  // idempotency, scoped IDs, approval binding) apply identically.
  //
  // Shape:
  //   POST /invoke/<tool_name>
  //   Authorization: Bearer <UAPM_MCP_SERVICE_TOKEN>
  //   x-on-behalf-of: <userId>              (required for user-scoped reads/writes)
  //   x-correlation-id: <uuid>              (optional; generated otherwise)
  //   Content-Type: application/json
  //   Body: { "arguments": { ...tool args } }
  //
  // Response: 200 with { "result": <tool structured result> }
  //           4xx/5xx with { "error": { "code": ..., "message": ... } }
  //
  // Tools are dispatched by name against the backend adapter so semantics are
  // identical to the MCP tool wiring in src/tools/*.ts.
  const invokeMap: Record<string, (p: Principal, args: any) => Promise<unknown>> = {
    list_projects: (p, a) => backend.listProjects(p, a ?? {}),
    get_project: (p, a) => backend.getProject(p, a.id),
    list_project_tasks: (p, a) => backend.listProjectTasks(p, a.projectId, a),
    get_task: (p, a) => backend.getTask(p, a.projectId, a.taskId),
    get_plan_version: (p, a) => backend.getPlanVersion(p, a.projectId, a.planVersionId),
    get_project_progress: (p, a) => backend.getProjectProgress(p, a.projectId),
    get_approval_status: (p, a) => backend.getApprovalStatus(p, a.projectId, a.planVersionId),
    list_activity_history: (p, a) => backend.listActivityHistory(p, a.projectId, a.cursor, a.limit),
    get_operation_status: (p, a) => backend.getOperationStatus(p, a.operationId),
    create_project: (p, a) => backend.createProject(p, a),
    create_plan_draft: (p, a) => backend.createPlanDraft(p, a),
    propose_plan_changes: (p, a) => backend.proposePlanChanges(p, a),
    request_plan_approval: (p, a) => backend.requestPlanApproval(p, a),
    publish_approved_plan: (p, a) => backend.publishApprovedPlan(p, a),
    update_task_status: (p, a) => backend.updateTaskStatus(p, a),
    update_task: (p, a) => backend.updateTask(p, a),
  };

  app.post("/invoke/:tool", async (req, res) => {
    let principal: Principal;
    try {
      principal = parsePrincipal(req, cfg.mcpServiceToken);
    } catch {
      res.status(401).json({ error: { code: "unauthorized", message: "Missing or invalid service token" } });
      return;
    }
    const toolName = req.params.tool;
    const impl = invokeMap[toolName];
    if (!impl) {
      res.status(404).json({ error: { code: "not_found", message: `Unknown tool: ${toolName}` } });
      return;
    }
    const log = withCorrelation(principal.correlationId!);
    try {
      const result = await impl(principal, (req.body ?? {}).arguments ?? {});
      res.status(200).json({ result });
    } catch (err: any) {
      const code = err?.code ?? "internal_error";
      const status = err?.status ?? (code === "human_only" ? 403 : code === "not_found" ? 404 : code === "unauthorized" ? 401 : code === "forbidden" ? 403 : 500);
      log.warn({ tool: toolName, code }, "invoke failed");
      res.status(status).json({ error: { code, message: String(err?.message ?? err) } });
    }
  });

  return app;
}
