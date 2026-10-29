import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  it,
  expect,
} from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { makePool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { passwordHash, hash, token, contentHash } from "../src/security.js";
import { workOnce, httpAdapter } from "../src/worker.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FastifyInstance } from "fastify";
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL is required; use the isolated uapm_test database",
  );
const parsed = new URL(url);
if (
  !["/uapm_test", "/uapm_g7_test"].includes(parsed.pathname) ||
  !["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname)
)
  throw new Error("Refusing to reset a database outside the explicitly named local test databases");
const pool = makePool(url);
let app: FastifyInstance,
  base: string,
  owner: string,
  other: string,
  password: string,
  cookie: string,
  csrf: string;
const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../packages/contracts/fixtures/plan-create.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const fresh = () => structuredClone(fixture);
type Client = { cookie?: string; csrf?: string; bearer?: string };
async function request(
  method: string,
  path: string,
  body?: unknown,
  client: Client = { cookie, csrf },
  key = randomUUID(),
) {
  const headers: Record<string, string> = {};
  if (client.cookie) headers.cookie = client.cookie;
  if (client.csrf) headers["x-csrf-token"] = client.csrf;
  if (client.bearer) headers.authorization = "Bearer " + client.bearer;
  if (method !== "GET") headers["idempotency-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
const project = async (name = "Release workspace") => {
  const r = await request("POST", "/api/v1/projects", { name });
  expect(r.status).toBe(201);
  return r.body;
};
const pp = (id: string) => "/api/v1/projects/" + id;
async function draft(id: string, input = fresh()) {
  const r = await request("POST", pp(id) + "/plans", input);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function approved(id: string, input = fresh()) {
  const plan = await draft(id, input);
  expect(
    (await request("POST", pp(id) + `/plans/${plan.id}/submit-review`)).status,
  ).toBe(200);
  const r = await request("POST", pp(id) + `/plans/${plan.id}/approvals`, {
    content_hash: plan.content_hash,
    decision: "approved",
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return plan;
}
async function published() {
  const p = await project(),
    plan = await approved(p.id);
  const result = await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
    content_hash: plan.content_hash,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return { p, plan, job: result.body };
}
async function service(
  projectId: string,
  scopes = ["read", "plans:write", "operations:write"],
) {
  const secret = token();
  const id = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,token_hash,token_expires_at,scopes) VALUES($1,'Automation','service',$2,now()+interval '1 day',$3) RETURNING id",
      [randomUUID() + "@service.invalid", hash(secret), scopes],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
    [projectId, id],
  );
  return { bearer: secret };
}
async function count(table: string, projectId: string) {
  return Number(
    (
      await pool.query(`SELECT count(*) FROM ${table} WHERE project_id=$1`, [
        projectId,
      ])
    ).rows[0].count,
  );
}
beforeAll(async () => {
  await migrate(pool);
  password = "Test-only-" + token();
}, 30000);
beforeEach(async () => {
  await pool.query("TRUNCATE users,projects CASCADE");
  const encoded = await passwordHash(password);
  owner = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES('owner@example.test','Owner','human',$1) RETURNING id",
      [encoded],
    )
  ).rows[0].id;
  other = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES('other@example.test','Other','human',$1) RETURNING id",
      [encoded],
    )
  ).rows[0].id;
  app = await buildApp({
    pool,
    secureCookies: false,
    allowedOrigin: "http://localhost:5173",
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const r = await request(
    "POST",
    "/api/v1/auth/login",
    { email: "owner@example.test", password },
    {},
  );
  expect(r.status).toBe(200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = r.body.csrf_token;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await pool.end();
});
describe("real HTTP + PostgreSQL backend", () => {
  it("applies migrations once and provisions all canonical entities", async () => {
    await migrate(pool);
    expect((await pool.query("SELECT * FROM schema_migrations")).rowCount).toBe(
      4,
    );
    for (const table of [
      "users",
      "projects",
      "project_members",
      "phases",
      "tasks",
      "task_dependencies",
      "plan_versions",
      "plan_task_drafts",
      "change_proposals",
      "approvals",
      "operation_jobs",
      "activity_events",
      "conversation_sessions",
      "idempotency_records",
    ])
      expect(
        (await pool.query("SELECT to_regclass($1) AS name", [table])).rows[0]
          .name,
      ).toBe(table);
  });
  it("validates login, cookie protection, session expiration and logout", async () => {
    expect(
      (
        await request(
          "POST",
          "/api/v1/auth/login",
          { email: "owner@example.test", password: "bad" },
          {},
        )
      ).status,
    ).toBe(401);
    expect((await request("GET", "/api/v1/auth/me")).body.id).toBe(owner);
    expect((await request("GET", "/api/v1/auth/session")).status).toBe(200);
    expect(
      (
        await request(
          "POST",
          "/api/v1/projects",
          { name: "No CSRF" },
          { cookie },
        )
      ).status,
    ).toBe(403);
    const login = await request(
      "POST",
      "/api/v1/auth/login",
      { email: "owner@example.test", password },
      {},
    );
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect((await request("POST", "/api/v1/auth/logout")).status).toBe(204);
    expect((await request("GET", "/api/v1/auth/me")).status).toBe(401);
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second'",
    );
    expect(
      (
        await request("GET", "/api/v1/auth/session", undefined, {
          cookie: login.headers.get("set-cookie")!.split(";")[0],
        })
      ).status,
    ).toBe(401);
  });
  it("creates independent owned projects and prevents manipulated IDs and viewer writes", async () => {
    const a = await project("A"),
      b = await project("B");
    expect(a.id).not.toBe(b.id);
    expect(a.owner_id).toBe(owner);
    const outsider = await request(
      "POST",
      "/api/v1/auth/login",
      { email: "other@example.test", password },
      {},
    );
    const client = {
      cookie: outsider.headers.get("set-cookie")!.split(";")[0],
      csrf: outsider.body.csrf_token,
    };
    expect((await request("GET", pp(a.id), undefined, client)).status).toBe(
      404,
    );
    expect(
      (await request("GET", "/api/v1/projects", undefined, client)).body.items,
    ).toHaveLength(0);
    expect(
      (await request("PATCH", pp(a.id), { version: 1, name: "Steal" }, client))
        .status,
    ).toBe(404);
    await pool.query("INSERT INTO project_members VALUES($1,$2,'viewer')", [
      a.id,
      other,
    ]);
    expect((await request("GET", pp(a.id), undefined, client)).status).toBe(
      200,
    );
    expect(
      (await request("POST", pp(a.id) + "/plans", fresh(), client)).status,
    ).toBe(403);
  });
  it("saves 12-task structured drafts without inventing assignees, dates or effort", async () => {
    const p = await project(),
      plan = await draft(p.id);
    expect(plan.snapshot.tasks).toHaveLength(12);
    expect(plan.content_hash).toBe(contentHash(plan.snapshot));
    expect(await count("plan_task_drafts", p.id)).toBe(12);
    expect(await count("tasks", p.id)).toBe(0);
    for (const t of plan.snapshot.tasks) {
      expect(t.assignee_id).toBeNull();
      expect(t.due_date).toBeNull();
      expect(t.estimated_effort).toBeNull();
    }
    expect(
      (await request("GET", pp(p.id) + `/plans/${plan.id}`)).body.content_hash,
    ).toBe(plan.content_hash);
  });
  it("enforces immutable snapshots, approvals and audit records inside PostgreSQL", async () => {
    const p = await project(),
      plan = await approved(p.id);
    await expect(
      pool.query("UPDATE plan_versions SET snapshot='{}' WHERE id=$1", [
        plan.id,
      ]),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("UPDATE plan_versions SET content_hash=$1 WHERE id=$2", [
        "0".repeat(64),
        plan.id,
      ]),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("DELETE FROM approvals WHERE plan_version_id=$1", [plan.id]),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query(
        "UPDATE plan_task_drafts SET data='{}' WHERE plan_version_id=$1",
        [plan.id],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("DELETE FROM activity_events WHERE project_id=$1", [p.id]),
    ).rejects.toThrow("immutable");
  });
  it("requires human approval of the exact hash and records rejection separately", async () => {
    const p = await project(),
      plan = await draft(p.id),
      svc = await service(p.id, [
        "read",
        "plans:write",
        "approvals:write",
        "plans:publish",
      ]);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
          content_hash: plan.content_hash,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request("POST", pp(p.id) + `/plans/${plan.id}/submit-review`))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          pp(p.id) + `/plans/${plan.id}/approvals`,
          { content_hash: plan.content_hash, decision: "approved" },
          svc,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/approvals`, {
          content_hash: "0".repeat(64),
          decision: "approved",
        })
      ).body.error.code,
    ).toBe("content_hash_mismatch");
    const rejected = await request(
      "POST",
      pp(p.id) + `/plans/${plan.id}/approvals`,
      {
        content_hash: plan.content_hash,
        decision: "rejected",
        comment: "Needs clarification",
      },
    );
    expect(rejected.status).toBe(201);
    expect(rejected.body.user_id).toBe(owner);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
          content_hash: plan.content_hash,
        })
      ).status,
    ).toBe(409);
  });
  it("publishes atomically and remains idempotent across new keys and concurrent commands", async () => {
    const p = await project(),
      plan = await approved(p.id),
      path = pp(p.id) + `/plans/${plan.id}/publish`,
      body = { content_hash: plan.content_hash },
      key = randomUUID();
    const results = await Promise.all([
      request("POST", path, body, undefined, key),
      request("POST", path, body, undefined, key),
      request("POST", path, body),
    ]);
    expect(results.map((x) => x.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((x) => x.body.id)).size).toBe(1);
    expect(await count("tasks", p.id)).toBe(12);
    expect(await count("phases", p.id)).toBe(3);
    expect(await count("task_dependencies", p.id)).toBe(11);
    const dbp = (await pool.query("SELECT * FROM projects WHERE id=$1", [p.id]))
      .rows[0];
    expect(dbp.published_plan_id).toBe(plan.id);
    expect(dbp.version).toBe(2);
    expect((await request("GET", pp(p.id) + "/dashboard")).body.total).toBe(12);
  });
  it("rolls back a mid-publication failure and safely retries the same key", async () => {
    const p = await project(),
      plan = await approved(p.id);
    await pool.query(
      "CREATE FUNCTION test_interrupt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_key='task-7' THEN RAISE EXCEPTION 'simulated interruption'; END IF;RETURN NEW;END $$; CREATE TRIGGER test_interrupt BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION test_interrupt()",
    );
    const path = pp(p.id) + `/plans/${plan.id}/publish`,
      body = { content_hash: plan.content_hash },
      key = randomUUID();
    try {
      expect((await request("POST", path, body, undefined, key)).status).toBe(
        500,
      );
      expect(await count("tasks", p.id)).toBe(0);
      expect(await count("phases", p.id)).toBe(0);
      expect(
        (
          await pool.query("SELECT status FROM plan_versions WHERE id=$1", [
            plan.id,
          ])
        ).rows[0].status,
      ).toBe("approved");
    } finally {
      await pool.query(
        "DROP TRIGGER test_interrupt ON tasks;DROP FUNCTION test_interrupt()",
      );
    }
    expect((await request("POST", path, body, undefined, key)).status).toBe(
      200,
    );
    expect(await count("tasks", p.id)).toBe(12);
  });
  it("rejects hash mismatch on publish and stale project approval publication", async () => {
    const p = await project(),
      plan = await approved(p.id);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
          content_hash: "f".repeat(64),
        })
      ).body.error.code,
    ).toBe("content_hash_mismatch");
    expect(
      (
        await request("PATCH", pp(p.id), {
          version: 1,
          description: "Changed scope",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
          content_hash: plan.content_hash,
        })
      ).body.error.code,
    ).toBe("stale_project_version");
    expect(await count("tasks", p.id)).toBe(0);
  });
  it("detects dependency cycles, unknown keys, duplicate keys and cross-project references", async () => {
    const p = await project();
    for (const modify of [
      (v: any) => v.snapshot.tasks[0].depends_on.push("task-12"),
      (v: any) => v.snapshot.tasks[0].depends_on.push("missing"),
      (v: any) => (v.snapshot.tasks[1].key = "task-1"),
      (v: any) => (v.snapshot.tasks[0].phase_key = "unknown"),
    ]) {
      const input = fresh();
      modify(input);
      expect((await request("POST", pp(p.id) + "/plans", input)).status).toBe(
        400,
      );
    }
    const { p: a, job } = await published(),
      b = await project(),
      input = fresh();
    input.snapshot.tasks[0].task_id = job.result.task_ids["task-1"];
    input.snapshot.tasks[0].expected_version = 1;
    expect((await request("POST", pp(b.id) + "/plans", input)).status).toBe(
      400,
    );
    expect(
      (
        await request(
          "GET",
          pp(b.id) + `/tasks/${job.result.task_ids["task-1"]}`,
        )
      ).status,
    ).toBe(404);
    expect(a.id).not.toBe(b.id);
  });
  it("enforces safe status transitions, dependencies, optimistic concurrency, and filtering", async () => {
    const { p, job } = await published(),
      t1 = job.result.task_ids["task-1"],
      t2 = job.result.task_ids["task-2"];
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
          version: 1,
          status: "done",
        })
      ).body.error.code,
    ).toBe("invalid_status_transition");
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t2}/status`, {
          version: 1,
          status: "in_progress",
        })
      ).body.error.code,
    ).toBe("dependencies_incomplete");
    const results = await Promise.all([
      request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
        version: 1,
        status: "in_progress",
      }),
      request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
        version: 1,
        status: "blocked",
      }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const current = (await request("GET", pp(p.id) + `/tasks/${t1}`)).body;
    if (current.status === "blocked")
      expect(
        (
          await request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
            version: current.version,
            status: "in_progress",
          })
        ).status,
      ).toBe(200);
    const active = (await request("GET", pp(p.id) + `/tasks/${t1}`)).body;
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
          version: active.version,
          status: "done",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t2}/status`, {
          version: 1,
          status: "in_progress",
        })
      ).status,
    ).toBe(200);
    const done = (await request("GET", pp(p.id) + `/tasks/${t1}`)).body;
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t1}/status`, {
          version: done.version,
          status: "in_progress",
        })
      ).body.error.code,
    ).toBe("active_dependents");
    expect(
      (await request("GET", pp(p.id) + "/tasks?status=done&q=Collect&limit=1"))
        .body.items,
    ).toHaveLength(1);
    expect(
      (await request("GET", pp(p.id) + `/tasks/${t2}/dependencies`)).body.items,
    ).toHaveLength(1);
    expect(
      (await request("GET", pp(p.id) + "/dashboard")).body.by_status.done,
    ).toBe(1);
  });
  it("routes material task edits through a fresh proposal and fresh approval", async () => {
    const { p, plan, job } = await published(),
      task = job.result.task_ids["task-1"];
    const r = await request("PATCH", pp(p.id) + `/tasks/${task}`, {
      version: 1,
      title: "Reviewed new title",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.id).not.toBe(plan.id);
    expect((await request("GET", pp(p.id) + `/tasks/${task}`)).body.title).toBe(
      "Collect stakeholder requirements",
    );
    expect(await count("change_proposals", p.id)).toBe(1);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${r.body.id}/publish`, {
          content_hash: r.body.content_hash,
        })
      ).status,
    ).toBe(409);
    await request("POST", pp(p.id) + `/plans/${r.body.id}/request-approval`);
    await request("POST", pp(p.id) + `/plans/${r.body.id}/approvals`, {
      content_hash: r.body.content_hash,
      decision: "approved",
    });
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${r.body.id}/publish`, {
          content_hash: r.body.content_hash,
        })
      ).status,
    ).toBe(200);
    expect(await count("tasks", p.id)).toBe(12);
    expect((await request("GET", pp(p.id) + `/tasks/${task}`)).body.title).toBe(
      "Reviewed new title",
    );
    expect(
      (await request("GET", pp(p.id) + `/plans/${plan.id}`)).body.status,
    ).toBe("superseded");
  });
  it("idempotently creates projects, refuses changed payload reuse, validates all inputs", async () => {
    const key = randomUUID(),
      a = await request(
        "POST",
        "/api/v1/projects",
        { name: "Retry" },
        undefined,
        key,
      ),
      b = await request(
        "POST",
        "/api/v1/projects",
        { name: "Retry" },
        undefined,
        key,
      );
    expect(a.body.id).toBe(b.body.id);
    expect(
      (
        await request(
          "POST",
          "/api/v1/projects",
          { name: "Different" },
          undefined,
          key,
        )
      ).status,
    ).toBe(409);
    for (const input of [
      { name: "" },
      { name: "X", owner_id: other },
      { name: "X", budget: 500 },
    ])
      expect((await request("POST", "/api/v1/projects", input)).status).toBe(
        400,
      );
    expect((await request("GET", "/api/v1/projects/not-a-uuid")).status).toBe(
      400,
    );
    expect((await request("GET", "/api/v1/projects?limit=1000")).status).toBe(
      400,
    );
    const r = await fetch(base + "/api/v1/projects", {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: '{"name":"No key"}',
    });
    expect(r.status).toBe(400);
  });
  it("limits service scopes and projects, expiry, disabled identities, and never exposes credentials", async () => {
    const a = await project(),
      b = await project(),
      svc = await service(a.id, ["read"]);
    expect((await request("GET", pp(a.id), undefined, svc)).status).toBe(200);
    expect((await request("GET", pp(b.id), undefined, svc)).status).toBe(404);
    expect(
      (await request("POST", pp(a.id) + "/plans", fresh(), svc)).status,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          pp(a.id) + "/agent/planning-requests",
          { prompt: "Plan" },
          svc,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("GET", pp(a.id), undefined, { bearer: token() })).status,
    ).toBe(401);
    const me = await request("GET", "/api/v1/auth/me", undefined, svc);
    expect(me.body).not.toHaveProperty("token_hash");
    expect(me.body).not.toHaveProperty("password_hash");
    await pool.query(
      "UPDATE users SET token_expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [hash(svc.bearer!)],
    );
    expect((await request("GET", pp(a.id), undefined, svc)).status).toBe(401);
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
    expect((await request("GET", pp(a.id))).status).toBe(401);
  });
  it("queues durable planning and conversation correlation, service callback creates only drafts", async () => {
    const p = await project(),
      svc = await service(p.id);
    const conv = await request("POST", pp(p.id) + "/conversations", {
      provider: "frontend",
      external_id: "session-42",
    });
    expect(conv.status).toBe(201);
    const op = await request("POST", pp(p.id) + "/agent/planning-requests", {
      prompt: "Build a project plan without inventing dates",
      conversation_session_id: conv.body.id,
    });
    expect(op.status).toBe(202);
    expect(op.body.status).toBe("queued");
    expect(op.body.input.base_project_version).toBe(1);
    expect(
      (
        await request("POST", `/api/v1/operations/${op.body.id}/result`, {
          result: fresh(),
        })
      ).status,
    ).toBe(403);
    const key = randomUUID(),
      path = `/api/v1/operations/${op.body.id}/result`,
      result = await request("POST", path, { result: fresh() }, svc, key);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.status).toBe("succeeded");
    expect(
      (await request("POST", path, { result: fresh() }, svc, key)).body.id,
    ).toBe(op.body.id);
    expect((await request("POST", path, { result: fresh() }, svc)).status).toBe(
      409,
    );
    expect(await count("plan_versions", p.id)).toBe(1);
    expect(await count("approvals", p.id)).toBe(0);
    expect(await count("tasks", p.id)).toBe(0);
    expect(
      (await request("GET", `/api/v1/operations/${op.body.id}`)).body
        .conversation_session_id,
    ).toBe(conv.body.id);
  });
  it("reclaims interrupted worker leases and retries with the same durable operation ID", async () => {
    const p = await project(),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Plan safely",
      });
    await pool.query(
      "UPDATE operation_jobs SET status='running',attempts=1,lease_until=now()-interval '1 second' WHERE id=$1",
      [op.body.id],
    );
    const deliveries: string[] = [];
    expect(
      await workOnce(pool, async (job) => {
        deliveries.push(job.id);
        return { result: fresh() };
      }),
    ).toBe(true);
    const result = await request("GET", `/api/v1/operations/${op.body.id}`);
    expect(result.body.status).toBe("succeeded");
    expect(result.body.attempts).toBe(2);
    expect(deliveries).toEqual([op.body.id]);
    expect(await count("plan_versions", p.id)).toBe(1);
    expect(
      await workOnce(pool, async () => {
        throw new Error("Must not redeliver");
      }),
    ).toBe(false);
  });
  it("bounds worker failures and exposes explicit terminal operation state", async () => {
    const p = await project(),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Plan",
      });
    for (let i = 0; i < 3; i++) {
      await workOnce(pool, async () => {
        throw new Error("secret upstream failure");
      });
      await pool.query(
        "UPDATE operation_jobs SET next_attempt_at=now() WHERE id=$1",
        [op.body.id],
      );
    }
    const result = await request("GET", `/api/v1/operations/${op.body.id}`);
    expect(result.body.status).toBe("failed");
    expect(result.body.attempts).toBe(3);
    expect(result.body.error).not.toContain("secret");
    expect(await workOnce(pool, async () => ({ result: fresh() }))).toBe(false);
  });
  it("enforces origin, payload limit, request IDs, security headers, login rate limit and readiness", async () => {
    const r = await fetch(base + "/api/v1/auth/login", {
      method: "POST",
      headers: {
        origin: "https://evil.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "owner@example.test", password }),
    });
    expect(r.status).toBe(403);
    const health = await request("GET", "/health", undefined, {});
    expect(health.status).toBe(200);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    expect((await request("GET", "/ready", undefined, {})).status).toBe(200);
    const big = await request("POST", "/api/v1/projects", {
      name: "x".repeat(1024 * 1024 + 1),
    });
    expect(big.status).toBe(413);
    let last;
    for (let i = 0; i < 11; i++)
      last = await request(
        "POST",
        "/api/v1/auth/login",
        { email: "owner@example.test", password: "bad" },
        {},
      );
    expect(last!.status).toBe(429);
  });
  it("records reliable actor/request IDs and stable list pagination", async () => {
    const { p } = await published();
    const events = await request("GET", pp(p.id) + "/activity?limit=100");
    expect(events.body.items.map((e: any) => e.type)).toContain(
      "plan.published",
    );
    for (const e of events.body.items) {
      expect(e.actor_id).toBe(owner);
      expect(e.request_id).toMatch(/^[a-f0-9-]{36}$/);
    }
    expect(
      (await request("GET", pp(p.id) + "/plans?limit=1")).body.items,
    ).toHaveLength(1);
    expect(
      (await request("GET", pp(p.id) + "/operations")).body.items,
    ).toHaveLength(1);
  });
  it("prevents project metadata lost updates and rejects proposals with invalid dates/assignees", async () => {
    const p = await project();
    const r = await Promise.all([
      request("PATCH", pp(p.id), { version: 1, name: "First" }),
      request("PATCH", pp(p.id), { version: 1, name: "Second" }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    const input = fresh();
    input.base_project_version = 2;
    input.snapshot.tasks[0].assignee_id = other;
    expect(
      (await request("POST", pp(p.id) + "/plans", input)).body.error.code,
    ).toBe("invalid_assignee");
    input.snapshot.tasks[0].assignee_id = null;
    input.snapshot.tasks[0].start_date = "2026-12-20";
    input.snapshot.tasks[0].due_date = "2026-12-01";
    expect((await request("POST", pp(p.id) + "/plans", input)).status).toBe(
      400,
    );
  });
  it("permits explicitly scoped service publication only after human approval", async () => {
    const p = await project(),
      svc = await service(p.id, ["read", "plans:write", "plans:publish"]);
    const draftResult = await request(
      "POST",
      pp(p.id) + "/plans",
      fresh(),
      svc,
    );
    expect(draftResult.status).toBe(201);
    const plan = draftResult.body;
    await request(
      "POST",
      pp(p.id) + `/plans/${plan.id}/submit-review`,
      undefined,
      svc,
    );
    expect(
      (
        await request(
          "POST",
          pp(p.id) + `/plans/${plan.id}/publish`,
          { content_hash: plan.content_hash },
          svc,
        )
      ).status,
    ).toBe(409);
    await request("POST", pp(p.id) + `/plans/${plan.id}/approvals`, {
      content_hash: plan.content_hash,
      decision: "approved",
    });
    expect(
      (
        await request(
          "POST",
          pp(p.id) + `/plans/${plan.id}/publish`,
          { content_hash: plan.content_hash },
          svc,
        )
      ).status,
    ).toBe(200);
    expect(await count("tasks", p.id)).toBe(12);
    expect(
      (await request("POST", "/api/v1/auth/logout", undefined, svc)).status,
    ).toBe(403);
  });
  it("rejects publication that would give completed work an incomplete predecessor", async () => {
    const { p, job } = await published(),
      first = job.result.task_ids["task-1"];
    await request("PATCH", pp(p.id) + `/tasks/${first}/status`, {
      version: 1,
      status: "in_progress",
    });
    await request("PATCH", pp(p.id) + `/tasks/${first}/status`, {
      version: 2,
      status: "done",
    });
    const input = fresh();
    input.base_project_version = 4;
    for (const t of input.snapshot.tasks) {
      t.task_id = job.result.task_ids[t.key];
      t.expected_version = t.key === "task-1" ? 3 : 1;
    }
    input.snapshot.tasks[0].depends_on = ["task-2"];
    input.snapshot.tasks[1].depends_on = [];
    const plan = await approved(p.id, input);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
          content_hash: plan.content_hash,
        })
      ).body.error.code,
    ).toBe("dependencies_incomplete");
    expect(await count("tasks", p.id)).toBe(12);
    expect(
      (await request("GET", pp(p.id) + `/tasks/${first}`)).body.version,
    ).toBe(3);
  });
  it("preserves asynchronous leases and fails exhausted interrupted operations explicitly", async () => {
    const p = await project(),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Async plan",
      });
    await workOnce(pool, async () => ({ accepted: true }));
    expect(
      (await request("GET", `/api/v1/operations/${op.body.id}`)).body.status,
    ).toBe("running");
    expect(
      await workOnce(pool, async () => {
        throw new Error("Live lease must not be delivered");
      }),
    ).toBe(false);
    await pool.query(
      "UPDATE operation_jobs SET attempts=3,lease_until=now()-interval '1 second' WHERE id=$1",
      [op.body.id],
    );
    await workOnce(pool, async () => ({ accepted: true }));
    expect(
      (await request("GET", `/api/v1/operations/${op.body.id}`)).body.status,
    ).toBe("failed");
  });
  it("freezes archived work and denies cross-project conversations and callbacks", async () => {
    const p = await project(),
      b = await project(),
      svc = await service(b.id);
    const conv = await request("POST", pp(b.id) + "/conversations", {
      provider: "test",
      external_id: "other",
    });
    expect(
      (
        await request("POST", pp(p.id) + "/agent/planning-requests", {
          prompt: "Plan",
          conversation_session_id: conv.body.id,
        })
      ).status,
    ).toBe(400);
    const op = await request("POST", pp(p.id) + "/agent/planning-requests", {
      prompt: "Plan",
    });
    expect(
      (await request("GET", `/api/v1/operations/${op.body.id}`, undefined, svc))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          "POST",
          `/api/v1/operations/${op.body.id}/result`,
          { result: fresh() },
          svc,
        )
      ).status,
    ).toBe(404);
    await request("PATCH", pp(p.id), { version: 1, status: "archived" });
    const input = fresh();
    input.base_project_version = 2;
    expect((await request("POST", pp(p.id) + "/plans", input)).status).toBe(
      409,
    );
    expect(
      (
        await request("POST", pp(p.id) + "/agent/planning-requests", {
          prompt: "Plan",
        })
      ).status,
    ).toBe(409);
  });
  it("F2 creation replay requires current membership, not cached historical access", async () => {
    const key = randomUUID(),
      body = { name: "Revoked creation" },
      created = await request("POST", "/api/v1/projects", body, undefined, key);
    expect(
      (await request("POST", "/api/v1/projects", body, undefined, key)).body.id,
    ).toBe(created.body.id);
    await pool.query(
      "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
      [created.body.id, owner],
    );
    expect(
      (await request("POST", "/api/v1/projects", body, undefined, key)).status,
    ).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM projects WHERE id=$1",
          [created.body.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("F2 mutation replay rechecks role, scopes, and concurrent permission changes", async () => {
    const p = await project(),
      key = randomUUID(),
      body = { version: 1, name: "Before downgrade" };
    expect(
      (await request("PATCH", pp(p.id), body, undefined, key)).status,
    ).toBe(200);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",
      [p.id, owner],
    );
    const replay = request("PATCH", pp(p.id), body, undefined, key);
    await blocker.query("COMMIT");
    blocker.release();
    expect((await replay).status).toBe(403);
    const b = await project(),
      svc = await service(b.id),
      sk = randomUUID(),
      input = fresh();
    expect(
      (await request("POST", pp(b.id) + "/plans", input, svc, sk)).status,
    ).toBe(201);
    await pool.query("UPDATE users SET scopes='{read}' WHERE token_hash=$1", [
      hash(svc.bearer!),
    ]);
    expect(
      (await request("POST", pp(b.id) + "/plans", input, svc, sk)).status,
    ).toBe(403);
  });
  it("F3 callback rejects original and relabeled stale bases without partial result or success record", async () => {
    const p = await project(),
      svc = await service(p.id),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Original requirement",
      });
    await request("PATCH", pp(p.id), {
      version: 1,
      description: "Requirements changed",
    });
    for (const v of [1, 2]) {
      const input = fresh();
      input.base_project_version = v;
      const key = randomUUID();
      const r = await request(
        "POST",
        `/api/v1/operations/${op.body.id}/result`,
        { result: input },
        svc,
        key,
      );
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("stale_operation");
      expect(
        (
          await pool.query("SELECT 1 FROM idempotency_records WHERE key=$1", [
            key,
          ])
        ).rowCount,
      ).toBe(0);
    }
    expect(await count("plan_versions", p.id)).toBe(0);
    expect(
      (await request("GET", `/api/v1/operations/${op.body.id}`)).body.status,
    ).toBe("queued");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM activity_events WHERE entity_id=$1 AND type='operation.succeeded'",
          [op.body.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("F3 worker cannot relabel work after requirements change during adapter execution", async () => {
    const p = await project(),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Original",
      });
    await workOnce(pool, async () => {
      expect(
        (
          await request("PATCH", pp(p.id), {
            version: 1,
            description: "New scope",
          })
        ).status,
      ).toBe(200);
      const input = fresh();
      input.base_project_version = 2;
      return { result: input };
    });
    const state = (await request("GET", `/api/v1/operations/${op.body.id}`))
      .body;
    expect(state.status).toBe("failed");
    expect(state.error).toBe("stale_operation");
    expect(state.result).toBeNull();
    expect(await count("plan_versions", p.id)).toBe(0);
  });
  it("F3 checks originating authorization and immutable identity/context on both result paths", async () => {
    const p = await project(),
      svc = await service(p.id),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Original",
      });
    expect(op.body.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(op.body.request_id).toBe(op.headers.get("x-request-id"));
    await expect(
      pool.query(
        "UPDATE operation_jobs SET input=jsonb_set(input,'{base_project_version}','2') WHERE id=$1",
        [op.body.id],
      ),
    ).rejects.toThrow("immutable operation context");
    await pool.query(
      "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
      [p.id, owner],
    );
    expect(
      (
        await request(
          "POST",
          `/api/v1/operations/${op.body.id}/result`,
          { result: fresh() },
          svc,
        )
      ).body.error.code,
    ).toBe("originating_authorization_revoked");
    let delivered = false;
    await workOnce(pool, async () => {
      delivered = true;
      return { result: fresh() };
    });
    expect(delivered).toBe(false);
    expect(await count("plan_versions", p.id)).toBe(0);
  });
  it("F3 accepted results retain original operation provenance and terminal retries stay idempotent", async () => {
    const p = await project(),
      svc = await service(p.id),
      op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Original",
      }),
      key = randomUUID(),
      path = `/api/v1/operations/${op.body.id}/result`;
    const result = await request("POST", path, { result: fresh() }, svc, key);
    expect(result.status).toBe(200);
    const saved = (
      await request(
        "GET",
        pp(p.id) + `/plans/${result.body.result.plan_version_id}`,
      )
    ).body;
    expect(saved.origin_operation_id).toBe(op.body.id);
    expect(saved.base_project_version).toBe(op.body.input.base_project_version);
    expect(
      (await request("POST", path, { result: fresh() }, svc, key)).body,
    ).toEqual(result.body);
    await pool.query(
      "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=(SELECT id FROM users WHERE token_hash=$2)",
      [p.id, hash(svc.bearer!)],
    );
    expect(
      (await request("POST", path, { result: fresh() }, svc, key)).status,
    ).toBe(403);
  });
  it("preserves allowlisted AI failure codes and scrubs arbitrary callback errors", async () => {
    const p = await project(),
      svc = await service(p.id);
    for (const [error, expected] of [
      ["AI_BUDGET_EXHAUSTED", "AI_BUDGET_EXHAUSTED"],
      ["AI_PLANNING_FAILED", "AI_PLANNING_FAILED"],
      ["provider secret", "Automation failed"],
    ]) {
      const op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Synthetic goal",
      });
      const result = await request(
        "POST",
        `/api/v1/operations/${op.body.id}/result`,
        { error },
        svc,
      );
      expect(result.status).toBe(200);
      expect(result.body.status).toBe("failed");
      expect(result.body.error).toBe(expected);
    }
  });
  it("F5 published callback schema and real HTTP agree for neither, either, both, empty error and unknown fields", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/contracts/schemas/operationResultRequest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(schema),
      p = await project(),
      svc = await service(p.id);
    const corpus = [
      { body: {}, valid: false },
      { body: { result: fresh() }, valid: true },
      { body: { error: "Clarification required" }, valid: true },
      { body: { result: fresh(), error: "Both" }, valid: false },
      { body: { error: "" }, valid: false },
      { body: { error: "x", extra: true }, valid: false },
    ];
    for (const { body, valid } of corpus) {
      expect(validate(body)).toBe(valid);
      const op = await request("POST", pp(p.id) + "/agent/planning-requests", {
        prompt: "Corpus",
      });
      expect(
        (
          await request(
            "POST",
            `/api/v1/operations/${op.body.id}/result`,
            body,
            svc,
          )
        ).status,
      ).toBe(valid ? 200 : 400);
    }
  });
  it("F6 rejects NUL across persisted fields without rows and preserves legitimate Unicode", async () => {
    const key = randomUUID();
    expect(
      (
        await request(
          "POST",
          "/api/v1/projects",
          { name: "bad\0name" },
          undefined,
          key,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/v1/projects", {
          name: "Valid",
          description: "bad\0description",
        })
      ).status,
    ).toBe(400);
    expect((await pool.query("SELECT 1 FROM projects")).rowCount).toBe(0);
    expect(
      (
        await pool.query("SELECT 1 FROM idempotency_records WHERE key=$1", [
          key,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await request("POST", "/api/v1/projects", { name: "bad\ud800" })).status,
    ).toBe(400);
    const p = await project("Проект — Grüße 🌍");
    for (const field of ["title", "description", "definition_of_done"]) {
      const input = fresh();
      input.snapshot.tasks[0][field] = "bad\0text";
      expect((await request("POST", pp(p.id) + "/plans", input)).status).toBe(
        400,
      );
    }
    expect(
      (
        await request("POST", pp(p.id) + "/agent/planning-requests", {
          prompt: "bad\0prompt",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("POST", pp(p.id) + "/conversations", {
          provider: "test",
          external_id: "bad\0id",
        })
      ).status,
    ).toBe(400);
    expect(await count("plan_versions", p.id)).toBe(0);
    expect(await count("activity_events", p.id)).toBe(1);
    const input = fresh();
    input.snapshot.tasks[0].description = "Добро пожаловать\nGrüße — 日本語 🚀";
    const plan = await draft(p.id, input);
    expect(plan.snapshot.tasks[0].description).toBe(
      input.snapshot.tasks[0].description,
    );
  });
  it("P1 disabling and reenabling does not revive an unconsumed approval", async () => {
    const p = await project(),
      plan = await approved(p.id),
      svc = await service(p.id, ["read", "plans:publish"]);
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [owner]);
    const history = await request(
      "GET",
      pp(p.id) + `/plans/${plan.id}/approvals`,
    );
    expect(history.body.items).toHaveLength(1);
    expect(history.body.revocations[0].source).toBe("identity_disabled");
    expect(
      (
        await request(
          "POST",
          pp(p.id) + `/plans/${plan.id}/publish`,
          { content_hash: plan.content_hash },
          svc,
        )
      ).body.error.code,
    ).toBe("approval_revoked");
    expect(await count("tasks", p.id)).toBe(0);
    await expect(
      pool.query("DELETE FROM approval_revocations WHERE approval_id=$1", [
        history.body.items[0].id,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("P1 role downgrade and membership removal permanently revoke pending approvals", async () => {
    for (const action of ["downgrade", "remove"]) {
      const p = await project(),
        plan = await approved(p.id),
        svc = await service(p.id, ["read", "plans:publish"]);
      if (action === "downgrade") {
        await pool.query(
          "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",
          [p.id, owner],
        );
        await pool.query(
          "UPDATE project_members SET role='owner' WHERE project_id=$1 AND user_id=$2",
          [p.id, owner],
        );
      } else {
        await pool.query(
          "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
          [p.id, owner],
        );
        await pool.query("INSERT INTO project_members VALUES($1,$2,'owner')", [
          p.id,
          owner,
        ]);
      }
      expect(
        (
          await request(
            "POST",
            pp(p.id) + `/plans/${plan.id}/publish`,
            { content_hash: plan.content_hash },
            svc,
          )
        ).body.error.code,
      ).toBe("approval_revoked");
      expect(await count("tasks", p.id)).toBe(0);
    }
  });
  it("P1 explicit human revocation is audited and services cannot revoke", async () => {
    const p = await project(),
      plan = await approved(p.id),
      svc = await service(p.id, ["read", "plans:publish", "approvals:write"]);
    const path = pp(p.id) + `/plans/${plan.id}/revoke-approval`;
    expect((await request("POST", path, { reason: "Stop" }, svc)).status).toBe(
      403,
    );
    const r = await request("POST", path, {
      reason: "Scope requires another review",
    });
    expect(r.status).toBe(201);
    expect(r.body.actor_id).toBe(owner);
    expect(
      (
        await request(
          "POST",
          pp(p.id) + `/plans/${plan.id}/publish`,
          { content_hash: plan.content_hash },
          svc,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM activity_events WHERE project_id=$1 AND type='approval.revoked'",
          [p.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("P1 consumed publication remains historical after approver disable", async () => {
    const { p, plan, job } = await published(),
      svc = await service(p.id, ["read", "plans:publish"]);
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
    const retry = await request(
      "POST",
      pp(p.id) + `/plans/${plan.id}/publish`,
      { content_hash: plan.content_hash },
      svc,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(job.id);
    expect(await count("tasks", p.id)).toBe(12);
    expect(
      (
        await request(
          "GET",
          pp(p.id) + `/plans/${plan.id}/approvals`,
          undefined,
          svc,
        )
      ).body.revocations,
    ).toHaveLength(0);
  });
  it("P1 publication serializes with a concurrent approver disable and cannot consume revoked approval", async () => {
    const p = await project(),
      plan = await approved(p.id),
      svc = await service(p.id, ["read", "plans:publish"]);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
    const pending = request(
      "POST",
      pp(p.id) + `/plans/${plan.id}/publish`,
      { content_hash: plan.content_hash },
      svc,
    );
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const lock = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT * FROM users WHERE id=$1 FOR SHARE'",
      );
      if (lock.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting).toBe(true);
    await blocker.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
    await blocker.query("COMMIT");
    blocker.release();
    expect((await pending).status).toBe(409);
    expect(await count("tasks", p.id)).toBe(0);
  });
  it("browser CSRF bootstrap survives reload without rotating other tabs and respects authentication", async () => {
    const a = await request("GET", "/api/v1/auth/csrf"),
      b = await request("GET", "/api/v1/auth/csrf");
    expect(a.status).toBe(200);
    expect(a.body.csrf_token).toBe(csrf);
    expect(b.body.csrf_token).toBe(csrf);
    expect(
      (
        await request(
          "POST",
          "/api/v1/projects",
          { name: "Reload mutation" },
          { cookie, csrf: a.body.csrf_token },
        )
      ).status,
    ).toBe(201);
    expect(
      (await request("GET", "/api/v1/auth/csrf", undefined, {})).status,
    ).toBe(401);
    const p = await project(),
      svc = await service(p.id);
    expect(
      (await request("GET", "/api/v1/auth/csrf", undefined, svc)).status,
    ).toBe(403);
  });
  it("P1 publication ordered before disable consumes approval without retroactive revocation", async () => {
    const p = await project(),
      plan = await approved(p.id),
      svc = await service(p.id, ["read", "plans:publish"]);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE");
    let released = false;
    try {
      const publish = request(
        "POST",
        pp(p.id) + `/plans/${plan.id}/publish`,
        { content_hash: plan.content_hash },
        svc,
      );
      let inserting = false;
      for (let i = 0; i < 100; i++) {
        if (
          (
            await pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO tasks%'",
            )
          ).rowCount
        ) {
          inserting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(inserting).toBe(true);
      const disable = pool.query("UPDATE users SET disabled=true WHERE id=$1", [
        owner,
      ]);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        if (
          (
            await pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='UPDATE users SET disabled=true WHERE id=$1'",
            )
          ).rowCount
        ) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query("COMMIT");
      blocker.release();
      released = true;
      expect((await publish).status).toBe(200);
      await disable;
      expect(await count("tasks", p.id)).toBe(12);
      expect(
        (
          await request(
            "GET",
            pp(p.id) + `/plans/${plan.id}/approvals`,
            undefined,
            svc,
          )
        ).body.revocations,
      ).toHaveLength(0);
    } finally {
      if (!released) {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    }
  });
});

describe("configured automation project assignment", () => {
  it("atomically assigns only the configured service and records an audit event", async () => {
    const secret = token();
    const serviceId = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,display_name,kind,token_hash,token_expires_at,scopes) VALUES($1,$2,'Synthetic automation','service',$3,now()+interval '1 day',$4)",
      [
        serviceId,
        serviceId + "@service.invalid",
        hash(secret),
        ["read", "plans:write", "operations:write"],
      ],
    );
    const isolated = await buildApp({
      pool,
      secureCookies: false,
      allowedOrigin: "http://localhost:25173",
      automationServiceId: serviceId,
    });
    try {
      const created = await isolated.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: {
          cookie,
          "x-csrf-token": csrf,
          "idempotency-key": randomUUID(),
        },
        payload: { name: "SYNTHETIC configured automation" },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      expect(
        (
          await pool.query(
            "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
            [id, serviceId],
          )
        ).rows[0].role,
      ).toBe("editor");
      expect(
        (
          await pool.query(
            "SELECT actor_id FROM activity_events WHERE project_id=$1 AND type='automation.member_assigned'",
            [id],
          )
        ).rows[0].actor_id,
      ).toBe(owner);
      expect(
        (
          await isolated.inject({
            method: "GET",
            url: pp(id),
            headers: { authorization: "Bearer " + secret },
          })
        ).statusCode,
      ).toBe(200);
      const unrelated = await project();
      expect(
        (
          await isolated.inject({
            method: "GET",
            url: pp(unrelated.id),
            headers: { authorization: "Bearer " + secret },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await isolated.close();
    }
  });
  it.each(["missing", "human"])(
    "fails atomically when the configured identity is %s",
    async (kind) => {
      const isolated = await buildApp({
        pool,
        secureCookies: false,
        allowedOrigin: "http://localhost:25173",
        automationServiceId: kind === "human" ? owner : randomUUID(),
      });
      try {
        const response = await isolated.inject({
          method: "POST",
          url: "/api/v1/projects",
          headers: {
            cookie,
            "x-csrf-token": csrf,
            "idempotency-key": randomUUID(),
          },
          payload: { name: "SYNTHETIC unavailable automation" },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe("internal_error");
        expect(
          (await pool.query("SELECT count(*)::int n FROM projects")).rows[0].n,
        ).toBe(0);
        expect(
          (await pool.query("SELECT count(*)::int n FROM activity_events"))
            .rows[0].n,
        ).toBe(0);
      } finally {
        await isolated.close();
      }
    },
  );
});

describe("G6 — task relations and member directory", () => {
  it("returns the project member directory with role and account state", async () => {
    const p = await project();
    await pool.query(
      "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
      [p.id, other],
    );
    const r = await request("GET", pp(p.id) + "/members");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toHaveLength(2);
    const owners = r.body.items.filter((m: any) => m.role === "owner");
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      user_id: owner,
      email: "owner@example.test",
      kind: "human",
      disabled: false,
    });
    const editor = r.body.items.find((m: any) => m.user_id === other)!;
    expect(editor.role).toBe("editor");
  });
  it("isolates members per project and refuses non-members with 404", async () => {
    const a = await project("A"),
      b = await project("B");
    await pool.query(
      "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
      [a.id, other],
    );
    const resp = await request("GET", pp(b.id) + "/members");
    expect(resp.body.items).toHaveLength(1);
    expect(resp.body.items[0].user_id).toBe(owner);
    const otherLogin = await request(
      "POST",
      "/api/v1/auth/login",
      { email: "other@example.test", password },
      {},
    );
    expect(
      (
        await request("GET", pp(b.id) + "/members", undefined, {
          cookie: otherLogin.headers.get("set-cookie")!.split(";")[0],
          csrf: otherLogin.body.csrf_token,
        })
      ).status,
    ).toBe(404);
  });
  it("edits task dependencies through a new plan draft that requires human approval before publication", async () => {
    const { p, job } = await published(),
      t1 = job.result.task_ids["task-1"],
      t4 = job.result.task_ids["task-4"],
      t5 = job.result.task_ids["task-5"];
    // Replace task-5's predecessor set with just [task-1] (fixture chain is 1→2→3→4→5).
    const task5 = (await request("GET", pp(p.id) + `/tasks/${t5}`)).body;
    const edit = await request("PATCH", pp(p.id) + `/tasks/${t5}`, {
      version: task5.version,
      depends_on: [t1],
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(201);
    expect(edit.body.status).toBe("draft");
    // Published task is unchanged until this exact plan is approved and published.
    expect(
      (await request("GET", pp(p.id) + `/tasks/${t5}/dependencies`)).body.items,
    ).toEqual([
      expect.objectContaining({ task_id: t5, depends_on_id: t4 }),
    ]);
    // Publishing without approval is rejected.
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${edit.body.id}/publish`, {
          content_hash: edit.body.content_hash,
        })
      ).status,
    ).toBe(409);
    await request("POST", pp(p.id) + `/plans/${edit.body.id}/request-approval`);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${edit.body.id}/approvals`, {
          content_hash: edit.body.content_hash,
          decision: "approved",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${edit.body.id}/publish`, {
          content_hash: edit.body.content_hash,
        })
      ).status,
    ).toBe(200);
    const deps = (
      await request("GET", pp(p.id) + `/tasks/${t5}/dependencies`)
    ).body.items;
    expect(deps).toEqual([
      expect.objectContaining({ task_id: t5, depends_on_id: t1 }),
    ]);
    expect(await count("change_proposals", p.id)).toBe(1);
    const activity = (await request("GET", pp(p.id) + "/activity")).body.items
      .map((e: any) => e.type)
      .filter((t: string) =>
        ["change_proposal.created", "plan.published"].includes(t),
      );
    expect(activity).toContain("change_proposal.created");
    expect(activity).toContain("plan.published");
  });
  it("rejects invalid dependency inputs: self, cycles, duplicates, nonexistent and cross-project references", async () => {
    const { p, job } = await published(),
      t1 = job.result.task_ids["task-1"],
      t3 = job.result.task_ids["task-3"];
    const invalid = async (depends_on: unknown, code: string) => {
      const r = await request("PATCH", pp(p.id) + `/tasks/${t3}`, {
        version: 1,
        depends_on,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error.code).toBe(code);
    };
    await invalid([t3], "self_dependency_not_allowed");
    await invalid([t1, t1], "duplicate_dependency");
    await invalid([randomUUID()], "invalid_dependency_reference");
    // Cross-project: use a task UUID from an unrelated project.
    const { job: otherJob } = await published();
    await invalid(
      [otherJob.result.task_ids["task-1"]],
      "invalid_dependency_reference",
    );
    // Cycle: task-1 cannot depend on task-3 (which already depends on task-2 → task-1).
    const cycle = await request("PATCH", pp(p.id) + `/tasks/${t1}`, {
      version: 1,
      depends_on: [t3],
    });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe("invalid_plan");
    expect(cycle.body.error.message).toMatch(/cycle/i);
  });
  it("detects stale task versions and keeps concurrent drafts independent and immutable", async () => {
    const { p, job } = await published(),
      t4 = job.result.task_ids["task-4"],
      t1 = job.result.task_ids["task-1"];
    const stale = await request("PATCH", pp(p.id) + `/tasks/${t4}`, {
      version: 99,
      depends_on: [t1],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_task_version");
    const [a, b] = await Promise.all([
      request("PATCH", pp(p.id) + `/tasks/${t4}`, {
        version: 1,
        depends_on: [t1],
      }),
      request("PATCH", pp(p.id) + `/tasks/${t4}`, {
        version: 1,
        title: "Parallel rename",
      }),
    ]);
    expect([a.status, b.status].every((s) => s === 201)).toBe(true);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.content_hash).not.toBe(b.body.content_hash);
    // Both proposals are independent immutable drafts; the published task is still untouched.
    const published4 = (await request("GET", pp(p.id) + `/tasks/${t4}`)).body;
    expect(published4.version).toBe(1);
    expect(published4.title).toMatch(/Review scope/);
  });
  it("E2E — three tasks with two dependency edges flow from draft to Kanban", async () => {
    const p = await project("E2E");
    const input = fresh();
    input.snapshot.tasks = input.snapshot.tasks.slice(0, 3).map((t: any) => ({
      ...t,
      depends_on: [],
    }));
    const plan = await draft(p.id, input);
    expect(
      (await request("POST", pp(p.id) + `/plans/${plan.id}/submit-review`))
        .status,
    ).toBe(200);
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${plan.id}/approvals`, {
          content_hash: plan.content_hash,
          decision: "approved",
        })
      ).status,
    ).toBe(201);
    const pub = await request("POST", pp(p.id) + `/plans/${plan.id}/publish`, {
      content_hash: plan.content_hash,
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const [t1, t2, t3] = [
      pub.body.result.task_ids["task-1"],
      pub.body.result.task_ids["task-2"],
      pub.body.result.task_ids["task-3"],
    ];
    await pool.query(
      "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
      [p.id, other],
    );
    // Add dependency edges t2→t1 and t3→t2 and change assignee on t2.
    const d2 = await request("PATCH", pp(p.id) + `/tasks/${t2}`, {
      version: 1,
      depends_on: [t1],
      assignee_id: other,
    });
    expect(d2.status, JSON.stringify(d2.body)).toBe(201);
    await request("POST", pp(p.id) + `/plans/${d2.body.id}/request-approval`);
    await request("POST", pp(p.id) + `/plans/${d2.body.id}/approvals`, {
      content_hash: d2.body.content_hash,
      decision: "approved",
    });
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${d2.body.id}/publish`, {
          content_hash: d2.body.content_hash,
        })
      ).status,
    ).toBe(200);
    const t3current = (await request("GET", pp(p.id) + `/tasks/${t3}`)).body;
    const d3 = await request("PATCH", pp(p.id) + `/tasks/${t3}`, {
      version: t3current.version,
      depends_on: [t2],
    });
    await request("POST", pp(p.id) + `/plans/${d3.body.id}/request-approval`);
    await request("POST", pp(p.id) + `/plans/${d3.body.id}/approvals`, {
      content_hash: d3.body.content_hash,
      decision: "approved",
    });
    expect(
      (
        await request("POST", pp(p.id) + `/plans/${d3.body.id}/publish`, {
          content_hash: d3.body.content_hash,
        })
      ).status,
    ).toBe(200);
    // Kanban-visible state matches the two edges.
    const dep2 = (await request("GET", pp(p.id) + `/tasks/${t2}/dependencies`))
      .body.items;
    const dep3 = (await request("GET", pp(p.id) + `/tasks/${t3}/dependencies`))
      .body.items;
    expect(dep2).toHaveLength(1);
    expect(dep2[0].depends_on_id).toBe(t1);
    expect(dep3).toHaveLength(1);
    expect(dep3[0].depends_on_id).toBe(t2);
    expect((await request("GET", pp(p.id) + `/tasks/${t2}`)).body.assignee_id).toBe(
      other,
    );
    const members = (await request("GET", pp(p.id) + "/members")).body.items;
    expect(members.map((m: any) => m.user_id).sort()).toEqual(
      [owner, other].sort(),
    );
    // Status transition respects the new dependency: t3 can only start after t1 → t2 are done.
    const t3final = (await request("GET", pp(p.id) + `/tasks/${t3}`)).body;
    expect(
      (
        await request("PATCH", pp(p.id) + `/tasks/${t3}/status`, {
          version: t3final.version,
          status: "in_progress",
        })
      ).body.error.code,
    ).toBe("dependencies_incomplete");
    expect(await count("change_proposals", p.id)).toBe(2);
    expect(await count("plan_versions", p.id)).toBe(3);
  });
});
