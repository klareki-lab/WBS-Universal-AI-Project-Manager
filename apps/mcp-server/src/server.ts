import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { errorToToolPayload } from "./errors.js";
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

  // Compatibility facade for the frozen n8n HTTP nodes. Calls the same MCP
  // tool catalog through the SDK; no domain state or alternate authorization.
  app.post("/mcp/call-tool", async (req, res) => {
    try { parsePrincipal(req,cfg.mcpServiceToken); }
    catch {res.status(401).json({error:{code:"unauthorized",message:"Invalid service token"}});return;}
    const client=new Client({name:"uapm-n8n-facade",version:"1.1.0"});
    const headers:Record<string,string>={authorization:`Bearer ${cfg.mcpServiceToken}`};
    for(const name of ["x-correlation-id","x-on-behalf-of","x-service-subject"]) if(req.header(name)) headers[name]=req.header(name)!;
    const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`),{requestInit:{headers}});
    try {
      await client.connect(transport);
      const result=await client.callTool({name:req.body.tool,arguments:req.body.arguments??{}});
      let data=result.structuredContent;
      if(!data){try{data=JSON.parse((result.content as any[]).find(c=>c.type==='text')?.text??'{}')}catch{data={error:{code:'mcp_response_unknown',message:'MCP response invalid. Mutation outcome may be unknown; retry only with the original idempotency key.'}}}}
      res.status(result.isError?422:200).json(data);
    } catch {res.status(503).json({error:{code:"mcp_response_unknown",message:"MCP request interrupted; retain the original idempotency key"}});}
    finally {await transport.terminateSession().catch(()=>{});await client.close().catch(()=>{});}
  });

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  return app;
}
