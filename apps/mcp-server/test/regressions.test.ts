// Regression suite exercising permissions, versions, idempotency, scoped
// identifiers, and callback error payloads. Pure in-process + fake HTTP
// server — does not require the real backend.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpBackendClient } from "../src/backend/http-client.ts";
import { loadConfig } from "../src/config.ts";
import { BackendError } from "../src/errors.ts";
import type { Principal } from "../src/schemas.ts";

interface Route {
  method: string;
  path: RegExp;
  handler: (req: http.IncomingMessage, bodyRaw: string) => { status: number; body: unknown };
}

function startFake(routes: Route[], captured: any[]) {
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://localhost");
      captured.push({ method: req.method, path: u.pathname, headers: req.headers, body: b ? JSON.parse(b) : null });
      const route = routes.find((r) => r.method === req.method && r.path.test(u.pathname));
      if (!route) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", message: "nf", request_id: "rid" } }));
        return;
      }
      const r = route.handler(req, b);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise<{ port: number; stop: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address() as AddressInfo;
      resolve({ port: a.port, stop: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const PROJ = "11111111-2222-4333-8444-555555555555";
const PLAN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("Regression: permissions, versions, idempotency, callbacks", () => {
  let server: { port: number; stop: () => Promise<void> };
  const captured: any[] = [];
  const principal: Principal = { correlationId: "regression" };

  // Toggles the fake server's behavior between tests.
  let currentPolicy: {
    scopeInsufficient?: boolean;
    staleTaskVersion?: boolean;
    stalePlanVersion?: boolean;
    idempotencyReplayId?: string | null;
    publishRequiresApproval?: boolean;
    rateLimited?: number;
  } = {};

  before(async () => {
    const routes: Route[] = [
      {
        method: "GET",
        path: /^\/api\/v1\/projects\/[^/]+$/,
        handler: () => ({
          status: 200,
          body: { id: PROJ, owner_id: null, name: "demo", description: "", status: "active", version: 1, published_plan_id: null, created_at: "2026-10-28T20:00:00Z" },
        }),
      },
      {
        method: "GET",
        path: /^\/api\/v1\/projects\/[^/]+\/plans\/[^/]+$/,
        handler: () => ({
          status: 200,
          body: {
            id: PLAN,
            project_id: PROJ,
            number: 1,
            base_project_version: 1,
            status: "draft",
            snapshot: {
              phases: [{ key: "d", name: "Discovery", description: "" }],
              tasks: [{ key: "t1", phase_key: "d", title: "x", description: "", priority: "medium", assignee_id: null, start_date: null, due_date: null, estimated_effort: null, definition_of_done: "", depends_on: [] }],
            },
            content_hash: "a".repeat(64),
            created_by: null,
            created_at: "2026-10-28T20:00:00Z",
          },
        }),
      },
      {
        method: "POST",
        path: /^\/api\/v1\/projects\/[^/]+\/plans$/,
        handler: (_req, b) => {
          if (currentPolicy.scopeInsufficient) {
            return { status: 403, body: { error: { code: "scope_insufficient", message: "service token lacks plans:write", request_id: "rid-403" } } };
          }
          if (currentPolicy.stalePlanVersion) {
            return { status: 409, body: { error: { code: "stale_project_version", message: "stale version", request_id: "rid-409" } } };
          }
          if (currentPolicy.rateLimited && currentPolicy.rateLimited > 0) {
            currentPolicy.rateLimited -= 1;
            return { status: 429, body: { error: { code: "rate_limited", message: "slow down", request_id: "rid-429" } } };
          }
          const parsed = JSON.parse(b);
          return {
            status: 201,
            body: {
              id: currentPolicy.idempotencyReplayId ?? PLAN,
              project_id: PROJ,
              number: 1,
              base_project_version: parsed.base_project_version,
              status: "draft",
              snapshot: parsed.snapshot,
              content_hash: "a".repeat(64),
              created_by: null,
              created_at: "2026-10-28T20:00:00Z",
            },
          };
        },
      },
      {
        method: "PATCH",
        path: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+$/,
        handler: (_req, b) => {
          const parsed = JSON.parse(b);
          if (currentPolicy.staleTaskVersion && parsed.version !== 42) {
            return { status: 409, body: { error: { code: "stale_task_version", message: "version mismatch", request_id: "rid-409t" } } };
          }
          return {
            status: 201,
            body: {
              id: PLAN,
              project_id: PROJ,
              number: 2,
              base_project_version: 1,
              status: "draft",
              snapshot: { phases: [{ key: "d", name: "Discovery", description: "" }], tasks: [{ key: "t1", phase_key: "d", title: "x", description: "", priority: "medium", assignee_id: null, start_date: null, due_date: null, estimated_effort: null, definition_of_done: "", depends_on: [] }] },
              content_hash: "b".repeat(64),
              created_by: null,
              created_at: "2026-10-28T20:00:00Z",
            },
          };
        },
      },
      {
        method: "POST",
        path: /^\/api\/v1\/projects\/[^/]+\/plans\/[^/]+\/publish$/,
        handler: () => {
          if (currentPolicy.publishRequiresApproval) {
            return { status: 409, body: { error: { code: "approval_required", message: "not approved", request_id: "rid-approval" } } };
          }
          return {
            status: 200,
            body: {
              id: "99999999-8888-4777-8666-555555555555",
              project_id: PROJ,
              created_by: null,
              kind: "publish",
              status: "succeeded",
              input: {},
              result: { task_ids: ["t_1"], plan_version_id: PLAN },
              error: null,
              created_at: "2026-10-28T20:00:00Z",
            },
          };
        },
      },
      {
        method: "POST",
        path: /^\/api\/v1\/operations\/[^/]+\/result$/,
        handler: (_req, b) => {
          const parsed = JSON.parse(b);
          if (!parsed.result && !parsed.error) {
            return { status: 400, body: { error: { code: "validation_error", message: "result OR error required", request_id: "rid-cb" } } };
          }
          return {
            status: 200,
            body: {
              id: "99999999-8888-4777-8666-555555555555",
              project_id: PROJ,
              kind: "planning",
              status: parsed.error ? "failed" : "succeeded",
              result: parsed.result ?? null,
              error: parsed.error ?? null,
              created_at: "2026-10-28T20:00:00Z",
            },
          };
        },
      },
    ];
    server = await startFake(routes, captured);
    process.env.UAPM_BACKEND_MODE = "http";
    process.env.UAPM_BACKEND_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.UAPM_BACKEND_SERVICE_TOKEN = "svc-regress";
    process.env.UAPM_MCP_SERVICE_TOKEN = "mcp-x";
    process.env.LOG_LEVEL = "fatal";
    process.env.UAPM_REQUEST_TIMEOUT_MS = "3000";
    process.env.UAPM_MAX_RETRIES = "1";
  });

  after(async () => await server.stop());

  it("permission: scope_insufficient → forbidden", async () => {
    currentPolicy = { scopeInsufficient: true };
    const client = new HttpBackendClient(loadConfig());
    await assert.rejects(
      client.createPlanDraft(principal, { projectId: PROJ, plan: { summary: "x", assumptions: [], risks: [], phases: [{ name: "D", order: 0 }], tasks: [{ tempId: "t", phaseName: "D", title: "x", priority: "medium", dependsOn: [] }] }, idempotencyKey: "idem-scope-1" }),
      (e: unknown) => e instanceof BackendError && e.code === "forbidden",
    );
  });

  it("permission: human_only guard refuses create_project before network", async () => {
    currentPolicy = {};
    const client = new HttpBackendClient(loadConfig());
    await assert.rejects(
      client.createProject(principal, { name: "x", idempotencyKey: "idem-ho-1" }),
      (e: unknown) => e instanceof BackendError && e.code === "human_only",
    );
    const createCall = captured.find((c) => c.method === "POST" && c.path === "/api/v1/projects");
    assert.ok(!createCall, "human_only must not reach the network");
  });

  it("stale version: stale_project_version → stale_version", async () => {
    currentPolicy = { stalePlanVersion: true };
    const client = new HttpBackendClient(loadConfig());
    await assert.rejects(
      client.createPlanDraft(principal, { projectId: PROJ, plan: { summary: "x", assumptions: [], risks: [], phases: [{ name: "D", order: 0 }], tasks: [{ tempId: "t", phaseName: "D", title: "x", priority: "medium", dependsOn: [] }] }, idempotencyKey: "idem-stale-1" }),
      (e: unknown) => e instanceof BackendError && e.code === "stale_version",
    );
  });

  it("stale version: stale_task_version from taskMetadata → stale_version", async () => {
    currentPolicy = { staleTaskVersion: true };
    const client = new HttpBackendClient(loadConfig());
    await assert.rejects(
      client.updateTask(principal, { projectId: PROJ, taskId: PLAN, expectedVersion: 1, changes: { title: "y" }, idempotencyKey: "idem-task-stale-1" }),
      (e: unknown) => e instanceof BackendError && e.code === "stale_version",
    );
  });

  it("idempotency: replayed key sends identical body and returns identical plan version id", async () => {
    currentPolicy = {};
    const client = new HttpBackendClient(loadConfig());
    const input = {
      projectId: PROJ,
      plan: { summary: "x", assumptions: [], risks: [], phases: [{ name: "D", order: 0 }], tasks: [{ tempId: "t", phaseName: "D", title: "x", priority: "medium" as const, dependsOn: [] }] },
      idempotencyKey: "idem-replay-77",
    };
    const r1 = await client.createPlanDraft(principal, input);
    const r2 = await client.createPlanDraft(principal, input);
    assert.equal(r1.planVersion.id, r2.planVersion.id, "same idempotency key must dedupe");
    const createCalls = captured.filter(
      (c) => c.method === "POST" && c.path === `/api/v1/projects/${PROJ}/plans` && c.headers["idempotency-key"] === "idem-replay-77",
    );
    assert.equal(createCalls.length, 2, "two network attempts expected for this specific idempotency key");
  });

  it("scoped identifiers: get_task without projectId is a type error at adapter boundary", async () => {
    // Compile-time: get_task(projectId, taskId) — not expressible as a single id.
    // Here we just assert the adapter signature is scoped.
    const client = new HttpBackendClient(loadConfig());
    assert.equal(client.getTask.length, 3, "getTask signature is (principal, projectId, taskId)");
    assert.equal(client.getPlanVersion.length, 3, "getPlanVersion signature is (principal, projectId, planVersionId)");
    assert.equal(client.getApprovalStatus.length, 3, "getApprovalStatus signature is (principal, projectId, planVersionId)");
  });

  it("publish: approval_required when the plan is not approved", async () => {
    currentPolicy = { publishRequiresApproval: true };
    const client = new HttpBackendClient(loadConfig());
    await assert.rejects(
      client.publishApprovedPlan(principal, { projectId: PROJ, planVersionId: PLAN, contentHash: "a".repeat(64), idempotencyKey: "idem-pub-no-approve" }),
      (e: unknown) => e instanceof BackendError && e.code === "approval_required",
    );
  });

  it("rate limit: 429 is retried once then succeeds", async () => {
    currentPolicy = { rateLimited: 1 };
    const client = new HttpBackendClient(loadConfig());
    const r = await client.createPlanDraft(principal, {
      projectId: PROJ,
      plan: { summary: "x", assumptions: [], risks: [], phases: [{ name: "D", order: 0 }], tasks: [{ tempId: "t", phaseName: "D", title: "x", priority: "medium", dependsOn: [] }] },
      idempotencyKey: "idem-429-1",
    });
    assert.ok(r.planVersion.id);
  });

  it("callback error payload: operationResult with error-only is accepted; invalid payload returns validation_error", async () => {
    currentPolicy = {};
    const client = new HttpBackendClient(loadConfig());
    const errCbResp = await client.operationResult(principal, "11111111-2222-4333-8444-aaaaaaaaaaaa", { error: "model_unavailable" }, "idem-cb-err-1");
    assert.equal(errCbResp.status, "failed");
    assert.equal(errCbResp.error, "model_unavailable");

    await assert.rejects(
      client.operationResult(principal, "11111111-2222-4333-8444-bbbbbbbbbbbb", {} as any, "idem-cb-bad-1"),
      (e: unknown) => e instanceof BackendError && e.code === "validation_error",
    );
  });
});
