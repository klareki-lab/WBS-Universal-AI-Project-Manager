import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
  HOST: "127.0.0.1",
  PORT: "26481",
  COOKIE_SECURE: "false",
  ALLOWED_ORIGIN: "http://localhost:26482",
  N8N_ENDPOINT: "",
  N8N_TOKEN: "",
};
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
assert.equal(
  execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "uapm.remediation"}}',
      "uapm-remediation-20261028-db",
    ],
    { encoding: "utf8" },
  ).trim(),
  "20261028",
);
const records = [],
  events = [];
let child;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function launch() {
  child = spawn(process.execPath, ["dist/apps/backend/src/server.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) =>
    events.push({ stream: "stdout", text: b.toString() }),
  );
  child.stderr.on("data", (b) =>
    events.push({ stream: "stderr", text: b.toString() }),
  );
  child.on("exit", (code, signal) => events.push({ exit: code, signal }));
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:26481/ready")).ok) return;
    } catch {}
    await sleep(100);
  }
  throw Error("not ready");
}
async function req(path, method = "GET", body, headers = {}) {
  const r = await fetch("http://127.0.0.1:26481" + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json();
  events.push({
    method,
    path,
    status: r.status,
    request_id: r.headers.get("x-request-id"),
  });
  return { r, b };
}
launch();
await ready();
const login = await req("/api/v1/auth/login", "POST", {
  email: "synthetic-audit-0@example.invalid",
  password: "SYNTHETIC-Audit-Only-2026!",
});
assert.equal(login.r.status, 200);
const headers = {
  cookie: login.r.headers.get("set-cookie").split(";")[0],
  "x-csrf-token": login.b.csrf_token,
  "idempotency-key": randomUUID(),
};
const body = { name: "SYNTHETIC outage retained commit" };
const a = await req("/api/v1/projects", "POST", body, headers);
assert.equal(a.r.status, 201);
execFileSync("docker", ["stop", "--time", "2", "uapm-remediation-20261028-db"]);
for (let i = 0; i < 30 && child.exitCode === null; i++) await sleep(100);
records.push({
  name: "Built server survives isolated PostgreSQL stop",
  status: child.exitCode === null ? "PASS" : "FAIL",
  actual_exit_code: child.exitCode,
  expectation: "process remains alive, /ready 503, reconnect after recovery",
});
if (child.exitCode === null) {
  const r = await req("/ready");
  records.push({
    name: "Outage readiness",
    status: r.r.status === 503 ? "PASS" : "FAIL",
  });
  child.kill("SIGTERM");
  await sleep(300);
}
execFileSync("docker", ["start", "uapm-remediation-20261028-db"]);
await sleep(1000);
launch();
await ready();
const b = await req("/api/v1/projects", "POST", body, headers);
records.push({
  name: "Full DB/application restart preserves session and idempotent response",
  status: b.r.status === 201 && b.b.id === a.b.id ? "PASS" : "FAIL",
  original_project: a.b.id,
  replayed_project: b.b.id,
  http_status: b.r.status,
});
const ownStats = execFileSync(
  "docker",
  [
    "stats",
    "--no-stream",
    "--format",
    "{{json .}}",
    "uapm-remediation-20261028-db",
  ],
  { encoding: "utf8" },
).trim();
child.kill("SIGTERM");
await sleep(300);
await writeFile(
  (process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current") +
    "/reliability.json",
  JSON.stringify(
    { records, events, database_stats: JSON.parse(ownStats) },
    null,
    2,
  ),
);
console.log(JSON.stringify(records, null, 2));
