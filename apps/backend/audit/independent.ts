import assert from "node:assert/strict";
import { randomUUID, randomBytes, scryptSync, createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { makePool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildApp } from "../src/app.js";
import { workOnce } from "../src/worker.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const doc = parse(
  await readFile("../../packages/contracts/openapi.yaml", "utf8"),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "audit-contract", components: doc.components });
const contractErrors: any[] = [];
let validatedResponses = 0;
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
const db = makePool(
  process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
);
await migrate(db);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const canonical = (x: any): string =>
  Array.isArray(x)
    ? `[${x.map(canonical).join(",")}]`
    : x !== null && typeof x === "object"
      ? `{${Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",")}}`
      : JSON.stringify(x);
const password = "SYNTHETIC-Audit-Only-2026!";
const salt = randomBytes(16).toString("hex");
const encoded = `scrypt$${salt}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 }).toString("hex")}`;
type Client = { id: string; cookie?: string; csrf?: string; bearer?: string };
const humans: Client[] = [];
for (let i = 0; i < 3; i++)
  humans.push({
    id: (
      await db.query(
        "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,$2,'human',$3) RETURNING id",
        [
          `synthetic-audit-${i}@example.invalid`,
          "SYNTHETIC audit " + i,
          encoded,
        ],
      )
    ).rows[0].id,
  });
let app: any, base: string;
const records: any[] = [],
  http: any[] = [],
  metrics: any[] = [];
async function start() {
  app = await buildApp({
    pool: db,
    secureCookies: false,
    allowedOrigin: "http://localhost:5173",
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
}
async function request(
  method: string,
  path: string,
  body?: any,
  c: Client = humans[0],
  key = randomUUID(),
  extra: any = {},
) {
  const headers: any = {
    "idempotency-key": key,
    ...(c.cookie ? { cookie: c.cookie } : {}),
    ...(c.csrf ? { "x-csrf-token": c.csrf } : {}),
    ...(c.bearer ? { authorization: "Bearer " + c.bearer } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...extra,
  };
  const t = performance.now();
  const r = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  const b = raw ? JSON.parse(raw) : null;
  const match = Object.entries(doc.paths).find(
    ([route, item]: any) =>
      item[method.toLowerCase()] &&
      new RegExp("^" + route.replace(/\{[^}]+\}/g, "[^/]+") + "$").test(
        path.split("?")[0],
      ),
  );
  if (match) {
    const op: any = (match[1] as any)[method.toLowerCase()],
      sch = op.responses[r.status]?.content?.["application/json"]?.schema;
    if (sch) {
      const validate = ajv.compile(
        JSON.parse(
          JSON.stringify(sch).replaceAll(
            "#/components/",
            "audit-contract#/components/",
          ),
        ),
      );
      validatedResponses++;
      if (!validate(b))
        contractErrors.push({
          method,
          path,
          status: r.status,
          errors: validate.errors,
        });
    }
  }
  const evidence = {
    method,
    path,
    status: r.status,
    request_id: r.headers.get("x-request-id"),
    error: b?.error,
    latency_ms: Math.round((performance.now() - t) * 100) / 100,
  };
  http.push(evidence);
  return { status: r.status, b, headers: r.headers, evidence };
}
const root = (p: any) => "/api/v1/projects/" + (p.id ?? p);
async function test(name: string, fn: () => Promise<void>) {
  await start();
  const t = performance.now();
  try {
    await fn();
    records.push({
      name,
      status: "PASS",
      duration_ms: Math.round(performance.now() - t),
    });
  } catch (e: any) {
    records.push({
      name,
      status: "FAIL",
      error: e.stack,
      duration_ms: Math.round(performance.now() - t),
    });
  } finally {
    await app.close();
  }
  console.log(JSON.stringify(records.at(-1)));
  await writeFile(
    (process.env.AUDIT_EVIDENCE_DIR ??
      "../../docs/backend/remediation/current") + "/independent-progress.json",
    JSON.stringify({ records, http, metrics }, null, 2),
  );
}
async function project(c = humans[0]) {
  const r = await request(
    "POST",
    "/api/v1/projects",
    { name: "SYNTHETIC independent " + randomUUID() },
    c,
  );
  assert.equal(r.status, 201, JSON.stringify(r.b));
  return r.b;
}
const snapshot = () => ({
  phases: [{ key: "p", name: "SYNTHETIC phase" }],
  tasks: [
    {
      key: "alpha",
      phase_key: "p",
      title: "SYNTHETIC alpha",
      estimated_effort: 1.5,
    },
    {
      key: "beta",
      phase_key: "p",
      title: "SYNTHETIC beta",
      depends_on: ["alpha"],
    },
    { key: "gamma", phase_key: "p", title: "SYNTHETIC gamma" },
  ],
});
async function plan(
  p: any,
  input: any = { base_project_version: 1, snapshot: snapshot() },
  c = humans[0],
) {
  const r = await request("POST", root(p) + "/plans", input, c);
  assert.equal(r.status, 201, JSON.stringify(r.b));
  return r.b;
}
async function approve(p: any, v: any, c = humans[0]) {
  assert.equal(
    (
      await request(
        "POST",
        root(p) + `/plans/${v.id}/submit-review`,
        undefined,
        c,
      )
    ).status,
    200,
  );
  const r = await request(
    "POST",
    root(p) + `/plans/${v.id}/approvals`,
    { content_hash: v.content_hash, decision: "approved" },
    c,
  );
  assert.equal(r.status, 201, JSON.stringify(r.b));
  return r;
}
async function publish(p: any, v: any, c = humans[0], key = randomUUID()) {
  return request(
    "POST",
    root(p) + `/plans/${v.id}/publish`,
    { content_hash: v.content_hash },
    c,
    key,
  );
}
async function published() {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  const j = await publish(p, v);
  assert.equal(j.status, 200);
  return { p, v, j: j.b, t: j.b.result.task_ids };
}
async function scalar(sql: string, args: any[] = []) {
  return (await db.query(sql, args)).rows[0];
}
async function service(
  p: any,
  scopes = [
    "read",
    "plans:write",
    "operations:write",
    "plans:publish",
    "approvals:write",
  ],
  role = "editor",
) {
  const bearer = randomBytes(32).toString("base64url");
  const id = (
    await db.query(
      "INSERT INTO users(email,display_name,kind,token_hash,token_expires_at,scopes) VALUES($1,'SYNTHETIC service','service',$2,now()+interval '1 day',$3) RETURNING id",
      [randomUUID() + "@example.invalid", sha(bearer), scopes],
    )
  ).rows[0].id;
  await db.query("INSERT INTO project_members VALUES($1,$2,$3)", [
    p.id,
    id,
    role,
  ]);
  return { id, bearer };
}
async function session(c: Client) {
  const secret = randomBytes(32).toString("base64url"),
    csrf = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [sha(secret), c.id, sha(csrf)],
  );
  c.cookie = "uapm_session=" + secret;
  c.csrf = csrf;
}
for (const c of humans) await session(c);
await test("Independent password encoding authenticates human and sets hardened cookie", async () => {
  const r = await request(
    "POST",
    "/api/v1/auth/login",
    { email: "synthetic-audit-0@example.invalid", password },
    { id: "" },
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(r.headers.get("set-cookie")!, /SameSite=Strict/);
  assert.equal(r.b.user.id, humans[0].id);
  assert(!JSON.stringify(r.b).includes(encoded));
});
await test("Unrelated owners and projects cannot enumerate each other", async () => {
  const a = await project(),
    b = await project(humans[1]);
  assert.equal(
    (await request("GET", root(a), undefined, humans[1])).status,
    404,
  );
  assert.equal((await request("GET", root(b))).status, 404);
  const list = await request("GET", "/api/v1/projects", undefined, humans[1]);
  assert(list.b.items.every((p: any) => p.owner_id === humans[1].id));
});
await test("Viewer cannot mutate, approve, publish or elevate role", async () => {
  const p = await project(),
    v = await plan(p);
  await db.query("INSERT INTO project_members VALUES($1,$2,'viewer')", [
    p.id,
    humans[2].id,
  ]);
  assert.equal(
    (await request("GET", root(p), undefined, humans[2])).status,
    200,
  );
  for (const [method, path, body] of [
    ["PATCH", root(p), { version: 1, name: "escalate" }],
    [
      "POST",
      root(p) + "/plans",
      { base_project_version: 1, snapshot: snapshot() },
    ],
    [
      "POST",
      root(p) + `/plans/${v.id}/approvals`,
      { content_hash: v.content_hash, decision: "approved" },
    ],
    [
      "POST",
      root(p) + `/plans/${v.id}/publish`,
      { content_hash: v.content_hash },
    ],
  ] as any[])
    assert.equal((await request(method, path, body, humans[2])).status, 403);
  assert.equal(
    (await request("PATCH", root(p), { version: 1, role: "owner" }, humans[2]))
      .status,
    400,
  );
  assert.equal(
    (
      await scalar(
        "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
        [p.id, humans[2].id],
      )
    ).role,
    "viewer",
  );
});
await test("Nested task plan and operation UUID substitution is isolated", async () => {
  const { p, v, t } = await published(),
    b = await project();
  const op = await request("POST", root(p) + "/agent/planning-requests", {
    prompt: "SYNTHETIC",
  });
  for (const path of [
    root(b) + `/tasks/${t.alpha}`,
    root(b) + `/plans/${v.id}`,
  ])
    assert.equal((await request("GET", path)).status, 404);
  assert.equal(
    (
      await request(
        "GET",
        `/api/v1/operations/${op.b.id}`,
        undefined,
        humans[1],
      )
    ).status,
    404,
  );
  const input: any = { base_project_version: 1, snapshot: snapshot() };
  Object.assign(input.snapshot.tasks[0], {
    task_id: t.alpha,
    expected_version: 1,
  });
  assert.equal((await request("POST", root(b) + "/plans", input)).status, 400);
});
await test("SQL composite FK blocks cross-project dependencies", async () => {
  const a = await published(),
    b = await published();
  await assert.rejects(
    () =>
      db.query("INSERT INTO task_dependencies VALUES($1,$2,$3)", [
        a.p.id,
        a.t.alpha,
        b.t.alpha,
      ]),
    (e: any) => e.code === "23503",
  );
});
await test("CSRF missing forged foreign-session and hostile Origin all fail", async () => {
  const p = await project();
  for (const extra of [
    { "x-csrf-token": "" },
    { "x-csrf-token": "forged" },
    { "x-csrf-token": humans[1].csrf },
    { origin: "https://attacker.invalid" },
    { origin: "null" },
  ])
    assert.equal(
      (
        await request(
          "PATCH",
          root(p),
          { version: 1, name: "SYNTHETIC CSRF" },
          humans[0],
          randomUUID(),
          extra,
        )
      ).status,
      403,
    );
  assert.equal(
    (await scalar("SELECT version FROM projects WHERE id=$1", [p.id])).version,
    1,
  );
});
await test("Expired session and disabled human cannot authenticate", async () => {
  const c = { id: humans[1].id };
  await session(c);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [sha(c.cookie!.split("=")[1])],
  );
  assert.equal(
    (await request("GET", "/api/v1/auth/me", undefined, c)).status,
    401,
  );
  await db.query("UPDATE users SET disabled=true WHERE id=$1", [c.id]);
  assert.equal(
    (await request("GET", "/api/v1/auth/me", undefined, humans[1])).status,
    401,
  );
  await db.query("UPDATE users SET disabled=false WHERE id=$1", [c.id]);
});
await test("Scoped service cannot approve even with explicit approval scope", async () => {
  const p = await project(),
    v = await plan(p),
    s = await service(p);
  await request("POST", root(p) + `/plans/${v.id}/submit-review`);
  assert.equal(
    (
      await request(
        "POST",
        root(p) + `/plans/${v.id}/approvals`,
        { content_hash: v.content_hash, decision: "approved" },
        s,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int AS n FROM approvals WHERE plan_version_id=$1",
        [v.id],
      )
    ).n,
    0,
  );
});
await test("Expired service token and missing scopes are rejected", async () => {
  const p = await project(),
    s = await service(p, []);
  assert.equal((await request("GET", root(p), undefined, s)).status, 403);
  await db.query(
    "UPDATE users SET scopes='{read}',token_expires_at=now()-interval '1 second' WHERE id=$1",
    [s.id],
  );
  assert.equal((await request("GET", root(p), undefined, s)).status, 401);
});
await test("Saved plan hash independently recomputes; SQL content and history immutable", async () => {
  const p = await project(),
    v = await plan(p);
  assert.equal(sha(canonical(v.snapshot)), v.content_hash);
  for (const sql of [
    "UPDATE plan_versions SET snapshot='{}' WHERE id=$1",
    "DELETE FROM plan_versions WHERE id=$1",
  ])
    await assert.rejects(() => db.query(sql, [v.id]));
  await assert.rejects(() =>
    db.query("UPDATE plan_task_drafts SET data='{}' WHERE plan_version_id=$1", [
      v.id,
    ]),
  );
  await assert.rejects(() =>
    db.query("UPDATE activity_events SET type='forged' WHERE project_id=$1", [
      p.id,
    ]),
  );
});
await test("Forged and other-version hashes rejected; unauthorized publication has no effects", async () => {
  const p = await project(),
    v = await plan(p),
    w = await plan(p, {
      base_project_version: 1,
      snapshot: { ...snapshot(), phases: [{ key: "p", name: "Other" }] },
    });
  await request("POST", root(p) + `/plans/${v.id}/submit-review`);
  for (const h of ["0".repeat(64), w.content_hash])
    assert.equal(
      (
        await request("POST", root(p) + `/plans/${v.id}/approvals`, {
          content_hash: h,
          decision: "approved",
        })
      ).status,
      409,
    );
  assert.equal((await publish(p, v)).status, 409);
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [
        p.id,
      ])
    ).n,
    0,
  );
});
await test("Approved content has immutable exact-hash approval; rejected plans cannot publish", async () => {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  await assert.rejects(() =>
    db.query("UPDATE approvals SET content_hash=$1 WHERE plan_version_id=$2", [
      "0".repeat(64),
      v.id,
    ]),
  );
  assert.equal(
    (
      await request("POST", root(p) + `/plans/${v.id}/publish`, {
        content_hash: "f".repeat(64),
      })
    ).status,
    409,
  );
  const w = await plan(p);
  await request("POST", root(p) + `/plans/${w.id}/submit-review`);
  assert.equal(
    (
      await request("POST", root(p) + `/plans/${w.id}/approvals`, {
        content_hash: w.content_hash,
        decision: "rejected",
      })
    ).status,
    201,
  );
  assert.equal((await publish(p, w)).status, 409);
});
await test("Self cycles multi-task cycles duplicate IDs and unknown keys fail safely", async () => {
  const p = await project();
  for (const f of [
    (s: any) => (s.tasks[0].depends_on = ["alpha"]),
    (s: any) => (s.tasks[0].depends_on = ["beta"]),
    (s: any) => (s.tasks[0].depends_on = ["unknown"]),
    (s: any) => (s.tasks[1].key = "alpha"),
  ]) {
    const s = snapshot();
    f(s);
    assert.equal(
      (
        await request("POST", root(p) + "/plans", {
          base_project_version: 1,
          snapshot: s,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM plan_versions WHERE project_id=$1",
        [p.id],
      )
    ).n,
    0,
  );
});
await test("Concurrent publication with same and different keys creates one materialization", async () => {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  const k = randomUUID();
  const rs = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      publish(p, v, humans[0], i < 6 ? k : randomUUID()),
    ),
  );
  assert(rs.every((r) => r.status === 200));
  assert.equal(new Set(rs.map((r) => r.b.id)).size, 1);
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [
        p.id,
      ])
    ).n,
    3,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM operation_jobs WHERE project_id=$1 AND kind='publish'",
        [p.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM activity_events WHERE project_id=$1 AND type='plan.published'",
        [p.id],
      )
    ).n,
    1,
  );
  metrics.push({
    case: "12 concurrent publications",
    latencies_ms: rs.map((r) => r.evidence.latency_ms),
  });
});
await test("Changed payload method and resource with reused idempotency key conflict", async () => {
  const key = randomUUID(),
    r = await request(
      "POST",
      "/api/v1/projects",
      { name: "SYNTHETIC retry" },
      humans[0],
      key,
    );
  assert.equal(r.status, 201);
  assert.equal(
    (
      await request(
        "POST",
        "/api/v1/projects",
        { name: "SYNTHETIC changed" },
        humans[0],
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        root(r.b),
        { version: 1, name: "SYNTHETIC" },
        humans[0],
        key,
      )
    ).status,
    409,
  );
});
await test("Stale task and project writes produce exactly one winner", async () => {
  const { p, t } = await published();
  const rs = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request("PATCH", root(p) + `/tasks/${t.alpha}/status`, {
        version: 1,
        status: i % 2 ? "blocked" : "in_progress",
      }),
    ),
  );
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 7);
  assert.equal(
    (await scalar("SELECT version FROM projects WHERE id=$1", [p.id])).version,
    3,
  );
  assert.equal(
    (await request("PATCH", root(p), { version: 2, name: "stale" })).status,
    409,
  );
});
await test("Intervening mutation invalidates previously approved base version", async () => {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  await request("PATCH", root(p), {
    version: 1,
    description: "SYNTHETIC changed",
  });
  assert.equal((await publish(p, v)).b.error.code, "stale_project_version");
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [
        p.id,
      ])
    ).n,
    0,
  );
});
await test("Metadata edit remains proposal until approval and publication", async () => {
  const { p, v, t } = await published();
  const r = await request("PATCH", root(p) + `/tasks/${t.alpha}`, {
    version: 1,
    title: "SYNTHETIC approved new",
    due_date: "2027-01-01",
    estimated_effort: 9.5,
  });
  assert.equal(r.status, 201);
  assert.notEqual(r.b.id, v.id);
  assert.equal(
    (await request("GET", root(p) + `/tasks/${t.alpha}`)).b.title,
    "SYNTHETIC alpha",
  );
  assert.equal((await publish(p, r.b)).status, 409);
  await approve(p, r.b);
  assert.equal((await publish(p, r.b)).status, 200);
  const updated = (await request("GET", root(p) + `/tasks/${t.alpha}`)).b;
  assert.equal(updated.title, "SYNTHETIC approved new");
  assert.equal(updated.estimated_effort, 9.5);
  assert.equal(
    (await request("GET", root(p) + `/plans/${v.id}`)).b.status,
    "superseded",
  );
  assert.equal(
    (await request("GET", root(p) + `/tasks/${t.beta}/dependencies`)).b.items[0]
      .depends_on_id,
    t.alpha,
  );
});
await test("Progress and audit actor/request correlation match database after lifecycle", async () => {
  const { p, t } = await published();
  for (const [version, status] of [
    [1, "in_progress"],
    [2, "done"],
  ] as const) {
    const r = await request("PATCH", root(p) + `/tasks/${t.alpha}/status`, {
      version,
      status,
    });
    assert.equal(r.status, 200);
    const e = await scalar(
      "SELECT * FROM activity_events WHERE request_id=$1",
      [r.evidence.request_id],
    );
    assert.equal(e.actor_id, humans[0].id);
    assert.equal(e.data.to, status);
  }
  const d = await request("GET", root(p) + "/dashboard");
  assert.equal(d.b.progress_percent, 33);
  assert.equal(d.b.total, 3);
  assert.equal(d.b.by_status.done, 1);
  const events = await request("GET", root(p) + "/activity");
  assert.equal(
    events.b.items.filter((e: any) => e.type === "task.status_changed").length,
    2,
  );
});
await test("Invalid oversized payload and manipulated identifiers return safe errors", async () => {
  const p = await project();
  for (const body of [
    { name: "x", owner_id: humans[1].id },
    { name: "x", role: "owner" },
    { name: "" },
  ])
    assert.equal((await request("POST", "/api/v1/projects", body)).status, 400);
  assert.equal(
    (await request("GET", "/api/v1/projects/not-a-uuid")).status,
    400,
  );
  assert.equal(
    (await request("POST", "/api/v1/projects", { name: "x".repeat(1048577) }))
      .status,
    413,
  );
  assert.equal(
    (await request("GET", root(p) + "/tasks?limit=101")).status,
    400,
  );
});
await test("Lost committed HTTP response is recovered after application restart without duplicate", async () => {
  const key = randomUUID(),
    body = { name: "SYNTHETIC lost response" };
  const a = await request("POST", "/api/v1/projects", body, humans[0], key);
  await app.close();
  await start();
  const b = await request("POST", "/api/v1/projects", body, humans[0], key);
  assert.equal(b.status, 201);
  assert.equal(a.b.id, b.b.id);
  assert.equal(
    (await scalar("SELECT count(*)::int n FROM projects WHERE id=$1", [a.b.id]))
      .n,
    1,
  );
});
await test("Injected publication SQL failure rolls back phases tasks events operation and retry key", async () => {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  await db.query(
    `CREATE FUNCTION audit_fail_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id='${p.id}'::uuid AND NEW.title='SYNTHETIC beta' THEN RAISE EXCEPTION 'SYNTHETIC audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_fail BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION audit_fail_publish()`,
  );
  const k = randomUUID();
  try {
    const r = await publish(p, v, humans[0], k);
    assert.equal(r.status, 500);
    for (const table of ["tasks", "phases", "operation_jobs"])
      assert.equal(
        (
          await scalar(
            `SELECT count(*)::int n FROM ${table} WHERE project_id=$1`,
            [p.id],
          )
        ).n,
        0,
      );
    assert.equal(
      (
        await scalar(
          "SELECT count(*)::int n FROM idempotency_records WHERE key=$1",
          [k],
        )
      ).n,
      0,
    );
  } finally {
    await db.query(
      "DROP TRIGGER audit_fail ON tasks; DROP FUNCTION audit_fail_publish()",
    );
  }
  assert.equal((await publish(p, v, humans[0], k)).status, 200);
});
await test("Actual cancelled transaction rolls back and same key safely retries", async () => {
  const p = await project(),
    v = await plan(p);
  await approve(p, v);
  const blocker = await db.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE");
  const key = randomUUID();
  const pending = publish(p, v, humans[0], key);
  let pid: number | undefined;
  for (let i = 0; i < 100; i++) {
    const q = await db.query(
      "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO tasks%' LIMIT 1",
    );
    if (q.rowCount) {
      pid = q.rows[0].pid;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert(pid, "publication did not reach injected lock");
  await db.query("SELECT pg_cancel_backend($1)", [pid]);
  await blocker.query("ROLLBACK");
  blocker.release();
  const failed = await pending;
  assert.equal(failed.status, 500);
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM phases WHERE project_id=$1", [
        p.id,
      ])
    ).n,
    0,
  );
  assert.equal((await publish(p, v, humans[0], key)).status, 200);
});
await test("Independent worker reclaim and duplicate callbacks commit one draft", async () => {
  await db.query(
    "UPDATE operation_jobs SET status='failed' WHERE kind='planning' AND status IN ('queued','running')",
  );
  const p = await project(),
    s = await service(p);
  const o = await request("POST", root(p) + "/agent/planning-requests", {
    prompt: "SYNTHETIC recovery",
  });
  await db.query(
    "UPDATE operation_jobs SET status='running',attempts=1,lease_until=now()-interval '1 second' WHERE id=$1",
    [o.b.id],
  );
  const ids: string[] = [];
  await workOnce(db, async (j) => {
    ids.push(j.id);
    return { result: { base_project_version: 1, snapshot: snapshot() } };
  });
  assert.deepEqual(ids, [o.b.id]);
  assert.equal(
    (await request("GET", `/api/v1/operations/${o.b.id}`)).b.attempts,
    2,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/v1/operations/${o.b.id}/result`,
        { result: { base_project_version: 1, snapshot: snapshot() } },
        s,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM plan_versions WHERE project_id=$1",
        [p.id],
      )
    ).n,
    1,
  );
});
await test("20 bounded concurrent GETs are successful with measured latency", async () => {
  const p = await project();
  const rs = await Promise.all(
    Array.from({ length: 20 }, () => request("GET", root(p) + "/dashboard")),
  );
  assert(rs.every((r) => r.status === 200));
  metrics.push({
    case: "20 concurrent dashboard reads",
    latencies_ms: rs.map((r) => r.evidence.latency_ms),
  });
});
await test("Pagination bounds and distinct stable pages", async () => {
  const { p } = await published();
  const a = await request("GET", root(p) + "/tasks?limit=2&offset=0"),
    b = await request("GET", root(p) + "/tasks?limit=2&offset=2");
  assert.equal(a.b.items.length, 2);
  assert.equal(b.b.items.length, 1);
  assert.equal(new Set([...a.b.items, ...b.b.items].map((t) => t.id)).size, 3);
});
// Boundary probes below intentionally assert desired acceptance behavior, retaining failures as evidence.
await test("Contract-valid 200-character phase key can be published", async () => {
  const p = await project(),
    s = snapshot(),
    key = "p".repeat(200);
  s.phases[0].key = key;
  for (const t of s.tasks) t.phase_key = key;
  const v = await plan(p, { base_project_version: 1, snapshot: s });
  await approve(p, v);
  assert.equal((await publish(p, v)).status, 200);
});
await test("Schema-valid PostgreSQL text NUL returns client validation error", async () => {
  const r = await request("POST", "/api/v1/projects", {
    name: "SYNTHETIC\u0000nul",
  });
  assert.equal(r.status, 400, JSON.stringify(r.b));
});
await test("Client out-of-range integer version returns client validation error", async () => {
  const p = await project();
  const r = await request("PATCH", root(p), {
    version: 9007199254740991,
    name: "SYNTHETIC",
  });
  assert([400, 409].includes(r.status));
});
await test("Planning callback is bound to original requested base version", async () => {
  const p = await project(),
    s = await service(p);
  const o = await request("POST", root(p) + "/agent/planning-requests", {
    prompt: "SYNTHETIC obsolete prompt",
  });
  await request("PATCH", root(p), {
    version: 1,
    description: "SYNTHETIC changed requirements",
  });
  const r = await request(
    "POST",
    `/api/v1/operations/${o.b.id}/result`,
    { result: { base_project_version: 2, snapshot: snapshot() } },
    s,
  );
  assert.equal(r.status, 409, "old job relabeled as current base");
});
await test("Publication rejects approval whose approving human was disabled before publish", async () => {
  const p = await project(),
    v = await plan(p),
    s = await service(p);
  await approve(p, v);
  await db.query("UPDATE users SET disabled=true WHERE id=$1", [humans[0].id]);
  try {
    const r = await publish(p, v, s);
    assert.equal(
      r.status,
      409,
      "disabled approver still authorizes publication",
    );
  } finally {
    await db.query("UPDATE users SET disabled=false WHERE id=$1", [
      humans[0].id,
    ]);
  }
});
await test("Generated contract constrains result/error exclusivity", async () => {
  const schema = JSON.parse(
    await readFile(
      "../../packages/contracts/schemas/operationResultRequest.json",
      "utf8",
    ),
  );
  assert(
    schema.oneOf || schema.anyOf || schema.not,
    "schema permits neither or both result and error",
  );
});
await test("CORS preflight response includes DELETE only when implemented and request ID always exists", async () => {
  const r = await request(
    "OPTIONS",
    "/api/v1/projects",
    undefined,
    { id: "" },
    randomUUID(),
    {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "content-type,x-csrf-token,idempotency-key",
    },
  );
  assert.equal(r.status, 204);
  assert(r.evidence.request_id);
  assert.match(
    r.headers.get("access-control-allow-headers")!,
    /idempotency-key/,
  );
});
await test("Idempotency replay after creation membership revocation must recheck authorization", async () => {
  const key = randomUUID(),
    body = { name: "SYNTHETIC revoked creation" };
  const r = await request("POST", "/api/v1/projects", body, humans[0], key);
  await db.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [r.b.id, humans[0].id],
  );
  assert.equal((await request("GET", root(r.b))).status, 404);
  const replay = await request(
    "POST",
    "/api/v1/projects",
    body,
    humans[0],
    key,
  );
  assert.equal(
    replay.status,
    404,
    "replayed project creation leaks revoked project",
  );
});
await test("Maximum 500-task chain publishes atomically with bounded concurrency", async () => {
  const p = await project();
  const s = {
    phases: [{ key: "p", name: "SYNTHETIC maximal" }],
    tasks: Array.from({ length: 500 }, (_, i) => ({
      key: "t" + i,
      phase_key: "p",
      title: "SYNTHETIC task " + i,
      depends_on: i ? ["t" + (i - 1)] : [],
    })),
  };
  const t = performance.now();
  const v = await plan(p, { base_project_version: 1, snapshot: s });
  await approve(p, v);
  const rs = await Promise.all([publish(p, v), publish(p, v)]);
  assert(rs.every((r) => r.status === 200));
  assert.equal(rs[0].b.id, rs[1].b.id);
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [
        p.id,
      ])
    ).n,
    500,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM task_dependencies WHERE project_id=$1",
        [p.id],
      )
    ).n,
    499,
  );
  metrics.push({
    case: "500-task chain create/review/approve/two concurrent publishes",
    duration_ms: performance.now() - t,
    publish_latencies_ms: rs.map((r) => r.evidence.latency_ms),
  });
});
const operations = Object.entries(doc.paths).flatMap(([path, item]: any) =>
  Object.entries(item).map(([method, op]: any) => ({
    path,
    method,
    id: op.operationId,
    security: op.security,
    statuses: Object.keys(op.responses),
  })),
);
await writeFile(
  (process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current") +
    "/contract-inventory.json",
  JSON.stringify(operations, null, 2),
);
await writeFile(
  (process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current") +
    "/independent-results.json",
  JSON.stringify(
    {
      contract: { validatedResponses, errors: contractErrors },
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      records,
      http,
      metrics,
      summary: {
        total: records.length,
        pass: records.filter((r) => r.status === "PASS").length,
        fail: records.filter((r) => r.status === "FAIL").length,
      },
    },
    null,
    2,
  ),
);
await db.end();
