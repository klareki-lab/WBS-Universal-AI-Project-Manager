import { spawn } from "node:child_process";
import http from "node:http";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const fixtureUrl = new URL(
  process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
);
assert.equal(fixtureUrl.hostname, "127.0.0.1");
assert.equal(fixtureUrl.port, "26439");
assert(
  /^\/uapm_(?:remediation(?:_[a-z0-9]+)?|audit_baseline)$/.test(
    fixtureUrl.pathname,
  ),
);
const db = new pg.Pool({
  connectionString:
    process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
});
await db.query(
  "UPDATE operation_jobs SET status='failed' WHERE kind='planning' AND status IN ('queued','running')",
);
const deliveries = [],
  logs = [],
  records = [];
let child,
  sendResult = false;
const fixture = http.createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const job = JSON.parse(raw);
  deliveries.push({
    operation_id: job.operation_id,
    idempotency_key: req.headers["idempotency-key"],
    base_version: job.input.base_project_version,
  });
  if (!sendResult) {
    res.writeHead(202).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      result: {
        base_project_version: job.input.base_project_version,
        snapshot: {
          phases: [{ key: "p", name: "SYNTHETIC crash recovery" }],
          tasks: [
            {
              key: "t",
              phase_key: "p",
              title: "SYNTHETIC recovered worker task",
            },
          ],
        },
      },
    }),
  );
});
await new Promise((r) => fixture.listen(26483, "127.0.0.1", r));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function launch() {
  child = spawn(process.execPath, ["dist/apps/backend/src/server.js"], {
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.AUDIT_DATABASE_URL ??
        "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
      PORT: "26484",
      HOST: "127.0.0.1",
      ALLOWED_ORIGIN: "http://localhost:26482",
      COOKIE_SECURE: "false",
      N8N_ENDPOINT: "http://127.0.0.1:26483/",
      N8N_TOKEN: "SYNTHETIC-LOCAL-AUDIT-ADAPTER",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => logs.push(b.toString()));
  child.stderr.on("data", (b) => logs.push(b.toString()));
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:26484/ready")).ok) return;
    } catch {}
    await pause(50);
  }
  throw Error("not ready");
}
async function req(path, method = "GET", body, headers = {}) {
  const r = await fetch("http://127.0.0.1:26484" + path, {
    method,
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, b: await r.json(), headers: r.headers };
}
try {
  launch();
  await ready();
  const l = await req("/api/v1/auth/login", "POST", {
    email: "synthetic-audit-0@example.invalid",
    password: "SYNTHETIC-Audit-Only-2026!",
  });
  const h = {
    cookie: l.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": l.b.csrf_token,
    "idempotency-key": randomUUID(),
  };
  const p = await req(
    "/api/v1/projects",
    "POST",
    { name: "SYNTHETIC killed worker" },
    h,
  );
  h["idempotency-key"] = randomUUID();
  const o = await req(
    "/api/v1/projects/" + p.b.id + "/agent/planning-requests",
    "POST",
    { prompt: "SYNTHETIC process death" },
    h,
  );
  for (let i = 0; i < 100 && deliveries.length === 0; i++) await pause(50);
  assert.equal(deliveries.length, 1);
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  const before = (
    await db.query("SELECT status,attempts FROM operation_jobs WHERE id=$1", [
      o.b.id,
    ])
  ).rows[0];
  assert.equal(before.status, "running");
  sendResult = true;
  // Accelerate only this audit operation's persisted lease; no wall-clock or source changes.
  await db.query(
    "UPDATE operation_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [o.b.id],
  );
  launch();
  await ready();
  let state;
  for (let i = 0; i < 100; i++) {
    state = (
      await db.query("SELECT * FROM operation_jobs WHERE id=$1", [o.b.id])
    ).rows[0];
    if (state.status === "succeeded") break;
    await pause(50);
  }
  assert.equal(state.status, "succeeded");
  assert.equal(state.attempts, 2);
  assert.equal(deliveries.length, 2);
  assert(
    deliveries.every(
      (d) => d.operation_id === o.b.id && d.idempotency_key === o.b.id,
    ),
  );
  const plans = (
    await db.query(
      "SELECT count(*)::int n FROM plan_versions WHERE project_id=$1",
      [p.b.id],
    )
  ).rows[0].n;
  assert.equal(plans, 1);
  const approvalCount = (
    await db.query(
      "SELECT count(*)::int n FROM approvals WHERE project_id=$1",
      [p.b.id],
    )
  ).rows[0].n;
  assert.equal(approvalCount, 0);
  records.push({
    name: "SIGKILL running worker then restart and reclaim lease commits one unapproved draft",
    status: "PASS",
    operation_id: o.b.id,
    before,
    after: { status: state.status, attempts: state.attempts },
    plan_count: plans,
    approval_count: approvalCount,
    lease_expiry: "accelerated by audit-only SQL",
  });
} catch (e) {
  records.push({
    name: "Worker process crash recovery",
    status: "FAIL",
    error: e.stack,
  });
} finally {
  child?.kill("SIGTERM");
  await pause(300);
  fixture.close();
  await db.end();
  await writeFile(
    (process.env.AUDIT_EVIDENCE_DIR ??
      "../../docs/backend/remediation/current") + "/worker-restart.json",
    JSON.stringify({ records, deliveries, logs }, null, 2),
  );
  console.log(JSON.stringify(records, null, 2));
}
