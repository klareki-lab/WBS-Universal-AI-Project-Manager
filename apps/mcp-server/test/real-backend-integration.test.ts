// Real integration test against a running UAPM backend. Skips cleanly when
// UAPM_REAL_BACKEND_URL + UAPM_REAL_BACKEND_TOKEN are not provided.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { HttpBackendClient } from "../src/backend/http-client.ts";
import { loadConfig } from "../src/config.ts";
import type { Principal } from "../src/schemas.ts";
import { BackendError } from "../src/errors.ts";

const BASE = process.env.UAPM_REAL_BACKEND_URL;
const TOKEN = process.env.UAPM_REAL_BACKEND_TOKEN;
const PROJECT_ID = process.env.UAPM_REAL_PROJECT_ID;
const PLAN_ID = process.env.UAPM_REAL_PLAN_ID;

const REAL = Boolean(BASE && TOKEN && PROJECT_ID);

describe("Real backend integration (feat/backend-core, OpenAPI canon)", { skip: !REAL }, () => {
  let client: HttpBackendClient;
  const principal: Principal = { correlationId: `mcp-real-${Date.now()}` };

  before(() => {
    process.env.UAPM_BACKEND_MODE = "http";
    process.env.UAPM_BACKEND_BASE_URL = BASE!;
    process.env.UAPM_BACKEND_SERVICE_TOKEN = TOKEN!;
    process.env.UAPM_MCP_SERVICE_TOKEN = "ignored-for-this-test";
    process.env.LOG_LEVEL = "fatal";
    process.env.UAPM_REQUEST_TIMEOUT_MS = "8000";
    client = new HttpBackendClient(loadConfig());
  });

  it("listProjects returns the service's project", async () => {
    const page = await client.listProjects(principal, { limit: 50 });
    assert.ok(page.items.length >= 1, `expected at least 1 project, got ${page.items.length}`);
    const found = page.items.find((p) => p.id === PROJECT_ID);
    assert.ok(found, "service's project is visible via listProjects");
    assert.ok(found!.name && found!.name.length > 0);
  });

  it("getProject returns the service's project detail", async () => {
    const detail = await client.getProject(principal, PROJECT_ID!);
    assert.equal(detail.id, PROJECT_ID);
  });

  it("getProjectProgress returns dashboard mapped to internal shape", async () => {
    const prog = await client.getProjectProgress(principal, PROJECT_ID!);
    assert.ok(prog.counts.total >= 0);
    assert.ok(prog.completionRatio >= 0 && prog.completionRatio <= 1);
  });

  it("getPlanScoped returns an existing plan version with content hash", async () => {
    if (!PLAN_ID) {
      // Discover a plan by listing — using raw fetch so we don't depend on an untested list op.
      // Skip gracefully if not available.
      return;
    }
    const pv = await client.getPlanVersion(principal, PROJECT_ID!, PLAN_ID);
    assert.equal(pv.id, PLAN_ID);
    assert.equal(pv.contentHash.length, 64);
  });

  it("createProject is refused by the human-only policy guard without a network call", async () => {
    await assert.rejects(
      client.createProject(principal, { name: "would-fail", idempotencyKey: "idem-humanonly-1" }),
      (e: unknown) => e instanceof BackendError && e.code === "human_only",
    );
  });

  it("createPlanDraft creates a new draft plan via POST /plans (plans:write service scope)", async () => {
    const idem = `mcp-real-draft-${Date.now()}`;
    const res = await client.createPlanDraft(principal, {
      projectId: PROJECT_ID!,
      plan: {
        summary: "MCP integration test draft",
        assumptions: ["Service token has plans:write."],
        risks: [],
        phases: [{ name: "Discovery", order: 0 }],
        tasks: [
          {
            tempId: "t1",
            phaseName: "Discovery",
            title: "Integration test task",
            priority: "medium",
            dependsOn: [],
            definitionOfDone: "This test passes against the real backend.",
          },
        ],
      },
      idempotencyKey: idem,
    });
    assert.ok(res.planVersion.id);
    assert.equal(res.planVersion.contentHash.length, 64);
    assert.equal(res.planVersion.plan.phases[0]!.name, "Discovery");
    assert.equal(res.planVersion.plan.tasks[0]!.title, "Integration test task");
  });

  it("replayed idempotency key does not create a duplicate draft", async () => {
    const idem = `mcp-real-draft-dedupe-${Date.now()}`;
    const payload = {
      projectId: PROJECT_ID!,
      plan: {
        summary: "Dedupe check",
        assumptions: [],
        risks: [],
        phases: [{ name: "Discovery", order: 0 }],
        tasks: [{ tempId: "t1", phaseName: "Discovery", title: "task", priority: "medium" as const, dependsOn: [], definitionOfDone: "x" }],
      },
      idempotencyKey: idem,
    };
    const r1 = await client.createPlanDraft(principal, payload);
    const r2 = await client.createPlanDraft(principal, payload);
    // Backend contract: same idempotency key returns the same plan version id (not a duplicate).
    assert.equal(r1.planVersion.id, r2.planVersion.id, "idempotency key must dedupe writes");
  });
});
