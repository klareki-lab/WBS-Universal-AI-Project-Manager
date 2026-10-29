import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makePool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { passwordHash } from "../src/security.js";
import type { FastifyInstance } from "fastify";
const dbUrl = process.env.G8_ISOLATED_DATABASE_URL;
if (!dbUrl) throw new Error("G8_ISOLATED_DATABASE_URL is required");
const parsed = new URL(dbUrl);
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "35467" ||
  parsed.pathname !== "/uapm_g8_test"
)
  throw new Error("Refusing non-G8 database");
const pool = makePool(dbUrl);
let app: FastifyInstance;
const suffix = randomUUID();
const password = "synthetic-g8-test-password";
let owner: string,
  editor: string,
  other: string,
  ownerCookie: string,
  ownerCsrf: string,
  editorCookie: string,
  editorCsrf: string,
  projectId: string;
async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: Record<string, unknown>,
  identity: "owner" | "editor" = "owner",
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      cookie: identity === "owner" ? ownerCookie : editorCookie,
      ...(method !== "GET"
        ? {
            "x-csrf-token": identity === "owner" ? ownerCsrf : editorCsrf,
            "idempotency-key": randomUUID(),
          }
        : {}),
    },
    ...(body !== undefined ? { payload: body } : {}),
  });
  return { status: response.statusCode, body: response.json() };
}
beforeAll(async () => {
  await migrate(pool);
  const pw = await passwordHash(password);
  const rows = await pool.query(
    "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'Synthetic owner','human',$4),($2,'Synthetic employee','human',$4),($3,'Synthetic outsider','human',$4) RETURNING id,email",
    [
      `owner-${suffix}@example.test`,
      `employee-${suffix}@example.test`,
      `outsider-${suffix}@example.test`,
      pw,
    ],
  );
  owner = rows.rows.find((r) => r.email.startsWith("owner-")).id;
  editor = rows.rows.find((r) => r.email.startsWith("employee-")).id;
  other = rows.rows.find((r) => r.email.startsWith("outsider-")).id;
  const company = (
    await pool.query("INSERT INTO companies(name) VALUES($1) RETURNING id", [
      `Synthetic ${suffix}`,
    ])
  ).rows[0].id;
  await pool.query(
    "INSERT INTO company_employees(company_id,user_id) VALUES($1,$2),($1,$3)",
    [company, owner, editor],
  );
  app = await buildApp({
    pool,
    secureCookies: false,
    allowedOrigin: "http://localhost:5173",
  });
  for (const [kind, email] of [
    ["owner", `owner-${suffix}@example.test`],
    ["editor", `employee-${suffix}@example.test`],
  ] as const) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(r.statusCode).toBe(200);
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    const csrf = r.json().csrf_token;
    if (kind === "owner") {
      ownerCookie = cookie;
      ownerCsrf = csrf;
    } else {
      editorCookie = cookie;
      editorCsrf = csrf;
    }
  }
  const p = await call("POST", "/api/v1/projects", {
    name: "Synthetic team project",
    description: "Test",
  });
  expect(p.status).toBe(201);
  projectId = p.body.id;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
describe("G8 isolated company and project authorization", () => {
  it("limits directory to company and owner, and allows only eligible employees and safe roles", async () => {
    const root = "/api/v1/projects/" + projectId;
    const directory = await call("GET", root + "/employees");
    expect(directory.status).toBe(200);
    expect(
      directory.body.items.map((u: { user_id: string }) => u.user_id),
    ).toContain(editor);
    expect(
      directory.body.items.map((u: { user_id: string }) => u.user_id),
    ).not.toContain(other);
    expect(
      (await call("POST", root + "/members/" + other, { role: "viewer" }))
        .status,
    ).toBe(400);
    await pool.query(
      "INSERT INTO company_employees(company_id,user_id) SELECT company_id,$2 FROM projects WHERE id=$1",
      [projectId, other],
    );
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [other]);
    expect(
      (await call("POST", root + "/members/" + other, { role: "viewer" }))
        .status,
    ).toBe(400);
    expect(
      (await call("POST", root + "/members/" + editor, { role: "owner" }))
        .status,
    ).toBe(400);
    expect(
      (await call("POST", root + "/members/" + editor, { role: "editor" }))
        .status,
    ).toBe(200);
    expect(
      (await call("GET", root + "/employees", undefined, "editor")).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          root + "/members/" + editor,
          { role: "viewer" },
          "editor",
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("POST", root + "/members/" + owner + "/remove")).status,
    ).toBe(409);
    expect(
      (await call("POST", root + "/members/" + editor, { role: "viewer" }))
        .status,
    ).toBe(200);
    expect(
      (await call("POST", root + "/members/" + editor + "/remove")).status,
    ).toBe(200);
    expect(
      (await call("POST", root + "/members/" + editor, { role: "viewer" }))
        .status,
    ).toBe(200);
    const snapshot = {
      phases: [{ key: "p", name: "Phase" }],
      tasks: [
        {
          key: "t",
          phase_key: "p",
          title: "Synthetic task",
          description: "Before",
          priority: "medium",
        },
      ],
    };
    const initial = await call("POST", root + "/plans", {
      base_project_version: 1,
      snapshot,
    });
    expect(initial.status).toBe(201);
    expect(
      (
        await call(
          "POST",
          root + "/plans/" + initial.body.id + "/submit-review",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", root + "/plans/" + initial.body.id + "/approvals", {
          content_hash: initial.body.content_hash,
          decision: "approved",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", root + "/plans/" + initial.body.id + "/publish", {
          content_hash: initial.body.content_hash,
        })
      ).status,
    ).toBe(200);
    const task = (await call("GET", root + "/tasks")).body.items[0];
    expect(task.assignee_id).toBeNull();
    const draft = await call("PATCH", root + "/tasks/" + task.id, {
      version: task.version,
      assignee_id: editor,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.snapshot.tasks[0].assignee_id).toBe(editor);
    const before = (
      await pool.query(
        "SELECT assignee_id,source_plan_id FROM tasks WHERE id=$1",
        [task.id],
      )
    ).rows[0];
    expect(before).toEqual({
      assignee_id: null,
      source_plan_id: initial.body.id,
    });
    const draftRow = (
      await pool.query(
        "SELECT status,snapshot FROM plan_versions WHERE id=$1",
        [draft.body.id],
      )
    ).rows[0];
    expect(draftRow.status).toBe("draft");
    expect(draftRow.snapshot.tasks[0].assignee_id).toBe(editor);
    expect(
      (await call("GET", root + "/tasks")).body.items[0].assignee_id,
    ).toBeNull();
    expect(
      (await call("POST", root + "/plans/" + draft.body.id + "/submit-review"))
        .status,
    ).toBe(200);
    expect(
      (
        await call("POST", root + "/plans/" + draft.body.id + "/approvals", {
          content_hash: "0".repeat(64),
          decision: "approved",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("GET", root + "/tasks")).body.items[0].assignee_id,
    ).toBeNull();
    expect(
      (
        await call("POST", root + "/plans/" + draft.body.id + "/approvals", {
          content_hash: draft.body.content_hash,
          decision: "approved",
        })
      ).status,
    ).toBe(201);
    expect(
      (await call("GET", root + "/tasks")).body.items[0].assignee_id,
    ).toBeNull();
    expect(
      (
        await call("POST", root + "/plans/" + draft.body.id + "/publish", {
          content_hash: draft.body.content_hash,
        })
      ).status,
    ).toBe(200);
    expect((await call("GET", root + "/tasks")).body.items[0].assignee_id).toBe(
      editor,
    );
    const publishedRow = (
      await pool.query(
        "SELECT assignee_id,source_plan_id FROM tasks WHERE id=$1",
        [task.id],
      )
    ).rows[0];
    expect(publishedRow).toEqual({
      assignee_id: editor,
      source_plan_id: draft.body.id,
    });
    const publicationEvents = await pool.query(
      "SELECT type FROM activity_events WHERE project_id=$1 AND entity_id=$2 AND type IN ('plan.approved','plan.published')",
      [projectId, draft.body.id],
    );
    expect(publicationEvents.rows.map((row) => row.type)).toEqual(
      expect.arrayContaining(["plan.approved", "plan.published"]),
    );
    expect(
      (await call("POST", root + "/members/" + editor + "/remove")).status,
    ).toBe(409);
    const legacy = await call("POST", "/api/v1/projects", {
      name: "Synthetic legacy project",
    });
    expect(legacy.status).toBe(201);
    await pool.query("UPDATE projects SET company_id=NULL WHERE id=$1", [
      legacy.body.id,
    ]);
    expect(
      (await call("GET", "/api/v1/projects/" + legacy.body.id + "/employees"))
        .status,
    ).toBe(409);
    expect(
      (await call("POST", "/api/v1/projects/" + legacy.body.id + "/company"))
        .status,
    ).toBe(200);
    expect(
      (await call("GET", "/api/v1/projects/" + legacy.body.id + "/employees"))
        .status,
    ).toBe(200);
    const events = await call("GET", root + "/activity");
    expect(events.body.items.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining([
        "member.added",
        "member.role_changed",
        "member.removed",
        "plan.approved",
        "plan.published",
      ]),
    );
  });
  it("preserves a structured multilingual brief in the planning context and rejects reversed dates", async () => {
    const bad = await call("POST", "/api/v1/projects", {
      name: "Synthetic invalid",
      start_date: "2026-12-31",
      end_date: "2026-01-01",
    });
    expect(bad.status).toBe(400);
    const brief = {
      name: "Synthetic multilingual brief",
      description: "Beschreibung",
      goals: "Ziele",
      requirements: "English: keep this text",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    };
    const created = await call("POST", "/api/v1/projects", brief);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(brief);
    const queued = await call(
      "POST",
      "/api/v1/projects/" + created.body.id + "/agent/planning-requests",
      { prompt: "Projekt planen" },
    );
    expect(queued.status).toBe(202);
    expect(queued.body.input.project_context).toMatchObject(brief);
    expect(queued.body.input.language_instruction).toContain(
      "standardmäßig auf Deutsch",
    );
  });
});
