// Full real-backend flow: human login → create project → service draft →
// service request-approval → human decidePlan → service publish (plans:publish).
//
// Driver variables (opt-in):
//   UAPM_REAL_BACKEND_URL              — e.g. http://127.0.0.1:13081
//   UAPM_REAL_HUMAN_EMAIL              — human user for cookie auth
//   UAPM_REAL_HUMAN_PASSWORD           — human user password
//   UAPM_REAL_ADMIN_CONTAINER          — docker container name running the backend
//
// This test provisions a per-project service token at test time via
//   docker exec <container> node dist/apps/backend/src/admin.js create-service
// with SERVICE_SCOPES=read,plans:write,plans:publish,operations:write.
//
// Skips cleanly when any required variable is missing.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { fetch } from "undici";
import { HttpBackendClient } from "../src/backend/http-client.ts";
import { loadConfig } from "../src/config.ts";
import type { Principal } from "../src/schemas.ts";

const BASE = process.env.UAPM_REAL_BACKEND_URL;
const EMAIL = process.env.UAPM_REAL_HUMAN_EMAIL;
const PASSWORD = process.env.UAPM_REAL_HUMAN_PASSWORD;
const CONTAINER = process.env.UAPM_REAL_ADMIN_CONTAINER;

const REAL = Boolean(BASE && EMAIL && PASSWORD && CONTAINER);

async function cookieLogin(baseUrl: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    const txt = await res.text().catch(() => "");
    throw new Error(`login failed status=${res.status} body=${txt}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookieMatch = /uapm_session=[^;]+/.exec(setCookie);
  if (!cookieMatch) throw new Error(`no uapm_session cookie in: ${setCookie}`);
  const body = (await res.json()) as any;
  const csrf = body.csrf_token ?? body.csrfToken;
  if (!csrf) throw new Error(`login response missing csrf_token: ${JSON.stringify(body)}`);
  return { cookie: cookieMatch[0], csrf, userId: body.user?.id ?? body.user_id };
}

async function cookieFetch(baseUrl: string, path: string, cookie: string, csrf: string, init: { method: string; body?: unknown; idempotencyKey?: string }) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie,
    "x-csrf-token": csrf,
  };
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  return fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

function provisionServiceToken(container: string, projectId: string): string {
  const serviceName = `mcp-publish-${Date.now()}`;
  const cmd = [
    "docker",
    "exec",
    "-e",
    `SERVICE_NAME=${serviceName}`,
    "-e",
    `SERVICE_PROJECT_ID=${projectId}`,
    "-e",
    "SERVICE_SCOPES=read,plans:write,plans:publish,operations:write",
    container,
    "node",
    "dist/apps/backend/src/admin.js",
    "create-service",
  ];
  const out = execSync(cmd.join(" "), { encoding: "utf8" });
  const line = out.split("\n").filter((l) => l.trim().startsWith("{")).pop() ?? "{}";
  const parsed = JSON.parse(line);
  const token = parsed.token;
  if (!token) throw new Error(`admin CLI did not emit a token: ${out}`);
  return token;
}

describe("Real backend: full publish flow (plans:publish + real human approval)", { skip: !REAL }, () => {
  let projectId: string;
  let serviceToken: string;
  let planVersionId: string;
  let contentHash: string;

  before(async () => {
    process.env.LOG_LEVEL = "fatal";

    const { cookie, csrf } = await cookieLogin(BASE!, EMAIL!, PASSWORD!);
    const projResp = await cookieFetch(BASE!, "/api/v1/projects", cookie, csrf, {
      method: "POST",
      body: { name: `MCP publish-flow test ${new Date().toISOString()}` },
      idempotencyKey: `mcp-pub-flow-${randomUUID()}`,
    });
    if (projResp.status !== 201) {
      const txt = await projResp.text().catch(() => "");
      throw new Error(`create project failed status=${projResp.status} body=${txt}`);
    }
    const project = (await projResp.json()) as any;
    projectId = project.id;

    serviceToken = provisionServiceToken(CONTAINER!, projectId);

    process.env.UAPM_BACKEND_MODE = "http";
    process.env.UAPM_BACKEND_BASE_URL = BASE!;
    process.env.UAPM_BACKEND_SERVICE_TOKEN = serviceToken;
    process.env.UAPM_MCP_SERVICE_TOKEN = "ignored";
  });

  it("service creates a plan draft via plans:write", async () => {
    const client = new HttpBackendClient(loadConfig());
    const principal: Principal = { correlationId: `pub-${Date.now()}` };
    const res = await client.createPlanDraft(principal, {
      projectId,
      baseProjectVersion: 1,
      plan: {
        summary: "Real publish flow",
        assumptions: [],
        risks: [],
        phases: [{ name: "Discovery", order: 0 }],
        tasks: [
          {
            tempId: "t1",
            phaseName: "Discovery",
            title: "Interview stakeholders",
            priority: "medium",
            dependsOn: [],
            definitionOfDone: "Notes stored.",
          },
        ],
      },
      idempotencyKey: `mcp-pub-draft-${randomUUID()}`,
    });
    planVersionId = res.planVersion.id;
    contentHash = res.planVersion.contentHash;
    assert.equal(contentHash.length, 64);
  });

  it("service requests approval (submit-review + request-approval sequencing)", async () => {
    const client = new HttpBackendClient(loadConfig());
    const principal: Principal = { correlationId: `pub-req-${Date.now()}` };
    await client.submitReview(principal, projectId, planVersionId, `mcp-submit-${randomUUID()}`);
    const res = await client.requestPlanApproval(principal, {
      projectId,
      planVersionId,
      idempotencyKey: `mcp-pub-req-${randomUUID()}`,
    });
    assert.equal(res.approval.state, "pending");
  });

  it("human decidePlan approves the plan (cookie + CSRF, content_hash binding)", async () => {
    const { cookie, csrf } = await cookieLogin(BASE!, EMAIL!, PASSWORD!);

    // Fetch plan state via cookie-authenticated GET to diagnose state mismatches.
    const stateResp = await fetch(`${BASE}/api/v1/projects/${projectId}/plans/${planVersionId}`, {
      headers: { cookie, "x-csrf-token": csrf },
    });
    const planState = (await stateResp.json()) as any;

    const resp = await cookieFetch(BASE!, `/api/v1/projects/${projectId}/plans/${planVersionId}/approvals`, cookie, csrf, {
      method: "POST",
      body: { content_hash: planState.content_hash ?? contentHash, decision: "approved", comment: "approved for mcp test" },
      idempotencyKey: `mcp-pub-decide-${randomUUID()}`,
    });
    if (resp.status !== 201) {
      const txt = await resp.text().catch(() => "");
      throw new Error(
        `decidePlan failed status=${resp.status} body=${txt} ` +
          `planStateBefore=${JSON.stringify({ status: planState.status, hash: planState.content_hash })}`,
      );
    }
    // Update contentHash to match the backend-stored one for the publish step.
    contentHash = planState.content_hash ?? contentHash;
  });

  it("service publishes the approved plan with plans:publish scope and content_hash", async () => {
    const client = new HttpBackendClient(loadConfig());
    const principal: Principal = { correlationId: `pub-publish-${Date.now()}` };
    const res = await client.publishApprovedPlan(principal, {
      projectId,
      planVersionId,
      contentHash,
      idempotencyKey: `mcp-pub-publish-${randomUUID()}`,
    });
    assert.ok(res.operationId);
    // Depending on backend processing mode, task IDs may be synchronous (sync publish)
    // or arrive via a succeeded operation. In both cases operationId must exist.
    assert.ok(res.publishedTaskIds.length >= 1 || res.operationId, "either task IDs or operation ID populated");
  });

  it("get_approval_status reports a real decidedBy (not derived)", async () => {
    const client = new HttpBackendClient(loadConfig());
    const principal: Principal = { correlationId: `pub-aud-${Date.now()}` };
    const status = await client.getApprovalStatus(principal, planVersionId, projectId);
    assert.equal(status.state, "approved");
    // Note: this is the strict assertion requested by G3. If the backend audit
    // log emits a different event type (not in APPROVAL_DECISION_TYPES), the
    // test will surface it so the mapping can be corrected.
    assert.ok(status.decidedBy, `decidedBy must be populated from the audit log; got ${JSON.stringify(status)}`);
  });
});
