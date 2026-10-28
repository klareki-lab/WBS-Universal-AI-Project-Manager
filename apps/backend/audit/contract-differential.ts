import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    await readFile(
      "../../packages/contracts/schemas/operationResultRequest.json",
      "utf8",
    ),
  ),
);
const base = "http://127.0.0.1:26481";
const login = await fetch(base + "/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "synthetic-audit-0@example.invalid",
    password: "SYNTHETIC-Audit-Only-2026!",
  }),
});
const b = await login.json();
const h = {
  cookie: login.headers.get("set-cookie")!.split(";")[0],
  "x-csrf-token": b.csrf_token,
  "idempotency-key": randomUUID(),
  "content-type": "application/json",
};
const p = await fetch(base + "/api/v1/projects", {
  method: "POST",
  headers: h,
  body: JSON.stringify({ name: "SYNTHETIC contract differential" }),
}).then((r) => r.json());
h["idempotency-key"] = randomUUID();
const op = await fetch(
  base + `/api/v1/projects/${p.id}/agent/planning-requests`,
  {
    method: "POST",
    headers: h,
    body: JSON.stringify({ prompt: "SYNTHETIC contract" }),
  },
).then((r) => r.json());
// Service principal is provisioned only in this isolated audit database.
const { default: pg } = await import("pg");
const db = new pg.Pool({
  connectionString:
    process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
});
const { randomBytes, createHash } = await import("node:crypto");
const token = randomBytes(32).toString("base64url");
const u = (
  await db.query(
    "INSERT INTO users(email,display_name,kind,token_hash,token_expires_at,scopes) VALUES($1,'SYNTHETIC contract service','service',$2,now()+interval '1 hour','{operations:write,plans:write}') RETURNING id",
    [
      randomUUID() + "@example.invalid",
      createHash("sha256").update(token).digest("hex"),
    ],
  )
).rows[0];
await db.query("INSERT INTO project_members VALUES($1,$2,'editor')", [
  p.id,
  u.id,
]);
const results = [];
for (const body of [
  {},
  {
    error: "SYNTHETIC failed",
    result: {
      base_project_version: 1,
      snapshot: {
        phases: [{ key: "p", name: "p" }],
        tasks: [{ key: "t", phase_key: "p", title: "SYNTHETIC" }],
      },
    },
  },
]) {
  const schema_accepts = validate(body);
  const r = await fetch(base + `/api/v1/operations/${op.id}/result`, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  results.push({
    body,
    schema_accepts,
    http_status: r.status,
    response: await r.json(),
    request_id: r.headers.get("x-request-id"),
  });
}
await db.end();
await writeFile(
  (process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current") +
    "/contract-differential.json",
  JSON.stringify(results, null, 2),
);
