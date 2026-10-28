import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { makePool } from "./db.js";
import { passwordHash, token, ensure } from "./security.js";
const database = process.env.DATABASE_URL;
if (!database) throw new Error("DATABASE_URL required");
const base = process.env.UAPM_BASE_URL ?? "http://127.0.0.1:13081";
const host = new URL(base);
ensure(
  ["localhost", "127.0.0.1"].includes(host.hostname),
  400,
  "local_smoke_only",
);
const pool = makePool(database);
let cookie = "",
  csrf = "";
const evidence: {
  method: string;
  path: string;
  status: number;
  request_id: string | null;
}[] = [];
async function http(
  method: string,
  path: string,
  body?: unknown,
  key = randomUUID(),
) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (method !== "GET") headers["idempotency-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;
  evidence.push({
    method,
    path,
    status: res.status,
    request_id: res.headers.get("x-request-id"),
  });
  ensure(res.ok, 500, "smoke_http_failure");
  if (path === "/api/v1/auth/login") {
    cookie = res.headers.get("set-cookie")!.split(";")[0];
    csrf = data.csrf_token;
  }
  return data;
}
try {
  const email =
      process.env.ADMIN_EMAIL ?? `smoke-${randomUUID()}@example.invalid`,
    password = process.env.ADMIN_PASSWORD ?? token(),
    name = process.env.ADMIN_NAME ?? "Local smoke fixture";
  ensure(password.length >= 12, 400, "password_too_short");
  const user = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,$2,'human',$3) RETURNING id",
      [email, name, await passwordHash(password)],
    )
  ).rows[0];
  await http("GET", "/health");
  await http("GET", "/ready");
  await http("POST", "/api/v1/auth/login", { email, password });
  const project = await http("POST", "/api/v1/projects", {
    name: "Backend E2E — release workspace",
    description: "Twelve realistic tasks over Discovery, Delivery and Launch.",
  });
  const second = await http("POST", "/api/v1/projects", {
    name: "Independent second workspace",
  });
  const path = "/api/v1/projects/" + project.id;
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../packages/contracts/fixtures/plan-create.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const plan = await http("POST", path + "/plans", fixture);
  await http("GET", path + `/plans/${plan.id}`);
  await http("POST", path + `/plans/${plan.id}/submit-review`);
  const approval = await http("POST", path + `/plans/${plan.id}/approvals`, {
    decision: "approved",
    content_hash: plan.content_hash,
  });
  const key = randomUUID(),
    job = await http(
      "POST",
      path + `/plans/${plan.id}/publish`,
      { content_hash: plan.content_hash },
      key,
    );
  const duplicate = await http(
    "POST",
    path + `/plans/${plan.id}/publish`,
    { content_hash: plan.content_hash },
    key,
  );
  ensure(job.id === duplicate.id, 500, "duplicate_operation");
  const first = job.result.task_ids["task-1"];
  await http("PATCH", path + `/tasks/${first}/status`, {
    version: 1,
    status: "in_progress",
  });
  await http("PATCH", path + `/tasks/${first}/status`, {
    version: 2,
    status: "done",
  });
  const dashboard = await http("GET", path + "/dashboard");
  await http("GET", path + "/activity");
  const sql = (
    await pool.query(
      `SELECT (SELECT count(*)::int FROM tasks WHERE project_id=$1) AS tasks,(SELECT count(*)::int FROM phases WHERE project_id=$1) AS phases,(SELECT count(*)::int FROM task_dependencies WHERE project_id=$1) AS dependencies,(SELECT count(*)::int FROM approvals WHERE project_id=$1) AS approvals,(SELECT count(*)::int FROM operation_jobs WHERE project_id=$1 AND kind='publish') AS publish_operations,(SELECT count(*)::int FROM tasks WHERE project_id=$2) AS other_project_tasks`,
      [project.id, second.id],
    )
  ).rows[0];
  ensure(
    sql.tasks === 12 &&
      sql.phases === 3 &&
      sql.dependencies === 11 &&
      sql.approvals === 1 &&
      sql.publish_operations === 1 &&
      sql.other_project_tasks === 0,
    500,
    "sql_evidence_mismatch",
  );
  const report = {
    status: "PASS",
    executed_at: new Date().toISOString(),
    base_url: base,
    user_id: user.id,
    project_id: project.id,
    second_project_id: second.id,
    plan_id: plan.id,
    approval_id: approval.id,
    content_hash: plan.content_hash,
    operation_id: job.id,
    database_counts: sql,
    dashboard: {
      total: dashboard.total,
      by_status: dashboard.by_status,
      progress_percent: dashboard.progress_percent,
    },
    http: evidence,
  };
  await writeFile(
    new URL("../../../docs/backend/evidence-smoke.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  // These examples contain domain objects only: never session, password or service secrets.
  await writeFile(
    new URL(
      "../../../packages/contracts/fixtures/example-responses.json",
      import.meta.url,
    ),
    JSON.stringify(
      { project, plan, approval, operation: job, dashboard },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await http("POST", "/api/v1/auth/logout");
} finally {
  await pool.end();
}
