import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { makePool } from "../dist/apps/backend/src/db.js";
const url =
  process.env.AUDIT_DATABASE_URL ??
  "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation";
assert.equal(new URL(url).port, "26439");
assert(/^\/uapm_remediation(?:_[a-z0-9]+)?$/.test(new URL(url).pathname));
const container = "uapm-remediation-20261028-db";
assert.equal(
  execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "uapm.remediation"}}',
      container,
    ],
    { encoding: "utf8" },
  ).trim(),
  "20261028",
);
const dir =
    process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current",
  records = [],
  http = [],
  logs = [];
let admin,
  child,
  stopped = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const controls = () => {
  const p = new pg.Pool({
    connectionString: url,
    application_name: "uapm-remediation-control",
    connectionTimeoutMillis: 2000,
  });
  p.on("error", () => {});
  return p;
};
const env = {
  ...process.env,
  DATABASE_URL: url,
  HOST: "127.0.0.1",
  PORT: "26481",
  COOKIE_SECURE: "false",
  ALLOWED_ORIGIN: "http://localhost:26482",
  N8N_ENDPOINT: "",
  N8N_TOKEN: "",
};
async function req(path, method = "GET", body, headers = {}) {
  const started = performance.now();
  const r = await fetch("http://127.0.0.1:26481" + path, {
    method,
    signal: AbortSignal.timeout(7000),
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text(),
    b = text ? JSON.parse(text) : null;
  http.push({
    path,
    method,
    status: r.status,
    request_id: r.headers.get("x-request-id"),
    duration_ms: Math.round(performance.now() - started),
  });
  return { status: r.status, b, headers: r.headers };
}
async function ready() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await req("/ready")).status === 200) return;
    } catch {}
    await pause(100);
  }
  throw Error("API failed to become ready");
}
try {
  admin = controls();
  child = spawn(process.execPath, ["dist/apps/backend/src/server.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => logs.push(b.toString()));
  child.stderr.on("data", (b) => logs.push(b.toString()));
  await ready();
  const pid = child.pid;
  const login = await req("/api/v1/auth/login", "POST", {
    email: "synthetic-audit-0@example.invalid",
    password: "SYNTHETIC-Audit-Only-2026!",
  });
  assert.equal(login.status, 200);
  const headers = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": login.b.csrf_token,
  };
  // Checked-out client receives an asynchronous error with no query in flight.
  const modulePool = makePool(url),
    checked = await modulePool.connect();
  const backend = (await checked.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  await admin.query("SELECT pg_terminate_backend($1)", [backend]);
  await pause(100);
  await assert.rejects(() => checked.query("SELECT 1"));
  checked.release(true);
  await modulePool.end();
  records.push({
    name: "Checked-out client asynchronous termination is handled and discarded",
    status: "PASS",
  });
  await req("/api/v1/auth/me", "GET", undefined, headers);
  const idle = await admin.query(
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='uapm-backend' AND state='idle'",
  );
  assert(idle.rowCount);
  for (const row of idle.rows)
    await admin.query("SELECT pg_terminate_backend($1)", [row.pid]);
  await pause(100);
  assert.equal(
    (await req("/api/v1/auth/me", "GET", undefined, headers)).status,
    200,
  );
  assert.equal(child.exitCode, null);
  records.push({
    name: "Built API survives idle connection termination and reconnects",
    status: "PASS",
    process_id: pid,
  });
  const createKey = randomUUID(),
    body = { name: "Retained across PostgreSQL outage" };
  const create = await req("/api/v1/projects", "POST", body, {
    ...headers,
    "idempotency-key": createKey,
  });
  assert.equal(create.status, 201);
  const p = create.b.id,
    fixture = {
      base_project_version: 1,
      snapshot: {
        phases: [{ key: "p", name: "Recovery phase" }],
        tasks: [{ key: "a", phase_key: "p", title: "Recovery task" }],
      },
    };
  const plan = await req(`/api/v1/projects/${p}/plans`, "POST", fixture, {
    ...headers,
    "idempotency-key": randomUUID(),
  });
  assert.equal(plan.status, 201);
  await req(
    `/api/v1/projects/${p}/plans/${plan.b.id}/submit-review`,
    "POST",
    undefined,
    { ...headers, "idempotency-key": randomUUID() },
  );
  await req(
    `/api/v1/projects/${p}/plans/${plan.b.id}/approvals`,
    "POST",
    { decision: "approved", content_hash: plan.b.content_hash },
    { ...headers, "idempotency-key": randomUUID() },
  );
  const blocker = await admin.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE");
  const publishKey = randomUUID(),
    publishPath = `/api/v1/projects/${p}/plans/${plan.b.id}/publish`,
    publishBody = { content_hash: plan.b.content_hash };
  const pending = req(publishPath, "POST", publishBody, {
    ...headers,
    "idempotency-key": publishKey,
  });
  let active;
  for (let i = 0; i < 100; i++) {
    const r = await admin.query(
      "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='uapm-backend' AND wait_event_type='Lock' AND query LIKE 'INSERT INTO tasks%' LIMIT 1",
    );
    if (r.rowCount) {
      active = r.rows[0].pid;
      break;
    }
    await pause(20);
  }
  assert(active, "publication never reached the controlled table lock");
  await admin.query("SELECT pg_terminate_backend($1)", [active]);
  await blocker.query("ROLLBACK");
  blocker.release();
  const failed = await pending;
  assert.equal(failed.status, 503);
  assert.equal(failed.b.error.code, "database_unavailable");
  for (const table of ["tasks", "phases"])
    assert.equal(
      (
        await admin.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`,
          [p],
        )
      ).rows[0].n,
      0,
    );
  assert.equal(
    (
      await admin.query("SELECT 1 FROM idempotency_records WHERE key=$1", [
        publishKey,
      ])
    ).rowCount,
    0,
  );
  const recovered = await req(publishPath, "POST", publishBody, {
    ...headers,
    "idempotency-key": publishKey,
  });
  assert.equal(recovered.status, 200);
  assert.equal(
    (
      await req(publishPath, "POST", publishBody, {
        ...headers,
        "idempotency-key": publishKey,
      })
    ).b.id,
    recovered.b.id,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
        [p],
      )
    ).rows[0].n,
    1,
  );
  records.push({
    name: "Terminated active publication rolls back, returns sanitized 503, and same-key retry commits once",
    status: "PASS",
    operation_id: recovered.b.id,
  });
  await admin.end();
  admin = null;
  execFileSync("docker", ["stop", "--time", "2", container]);
  stopped = true;
  await pause(100);
  assert.equal(child.exitCode, null);
  assert.equal((await req("/health")).status, 200);
  assert.equal((await req("/ready")).status, 503);
  const offline = await req("/api/v1/projects", "POST", body, {
    ...headers,
    "idempotency-key": createKey,
  });
  assert.equal(offline.status, 503);
  assert.equal(offline.b.error.code, "database_unavailable");
  assert(http.at(-1).duration_ms < 5000);
  records.push({
    name: "PostgreSQL stop leaves API alive, health 200/readiness 503 and bounded sanitized mutation failure",
    status: "PASS",
    process_id: pid,
  });
  execFileSync("docker", ["start", container]);
  stopped = false;
  await ready();
  assert.equal(child.pid, pid);
  assert.equal(child.exitCode, null);
  const replay = await req("/api/v1/projects", "POST", body, {
    ...headers,
    "idempotency-key": createKey,
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.b.id, p);
  admin = controls();
  assert.equal(
    (
      await admin.query("SELECT count(*)::int AS n FROM projects WHERE id=$1", [
        p,
      ])
    ).rows[0].n,
    1,
  );
  records.push({
    name: "Same API process recovers after DB restart with session and exactly one idempotent resource",
    status: "PASS",
    process_id: pid,
    project_id: p,
  });
} catch (error) {
  records.push({
    name: "Recovery acceptance",
    status: "FAIL",
    error: error.stack,
  });
  process.exitCode = 1;
} finally {
  if (stopped) execFileSync("docker", ["start", container]);
  child?.kill("SIGTERM");
  await pause(300);
  await admin?.end();
  await writeFile(
    dir + "/recovery.json",
    JSON.stringify({ records, http, logs }, null, 2) + "\n",
  );
  console.log(JSON.stringify(records, null, 2));
}
