import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { makePool } from "../dist/apps/backend/src/db.js";
import { migrate } from "../dist/apps/backend/src/migrate.js";
import { buildApp } from "../dist/apps/backend/src/app.js";
import {
  token,
  passwordHash,
  contentHash,
} from "../dist/apps/backend/src/security.js";
const url =
  process.env.UPGRADE_DATABASE_URL ??
  "postgresql://uapm_audit@127.0.0.1:26439/uapm_upgrade_rc2";
assert.equal(new URL(url).port, "26439");
assert(/^\/uapm_upgrade_rc[0-9]*$/.test(new URL(url).pathname));
assert.equal(new URL(url).hostname, "127.0.0.1");
const pool = makePool(url),
  records = [];
let app;
try {
  for (const name of ["001_core.sql", "002_publish_uniqueness.sql"])
    await pool.query(
      execFileSync(
        "git",
        [
          "show",
          `7faca555776d134c3483c5667bfb567487932fe4:apps/backend/migrations/${name}`,
        ],
        { encoding: "utf8" },
      ),
    );
  await pool.query(
    "CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());INSERT INTO schema_migrations(name) VALUES('001_core.sql'),('002_publish_uniqueness.sql')",
  );
  const password = token(),
    email = token().toLowerCase() + "@upgrade.invalid";
  const owner = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'Upgrade owner','human',$2) RETURNING id",
      [email, await passwordHash(password)],
    )
  ).rows[0].id;
  const reviewer = (
    await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'Upgrade reviewer','human',$2) RETURNING id",
      [token() + "@upgrade.invalid", await passwordHash(token())],
    )
  ).rows[0].id;
  const project = (
    await pool.query(
      "INSERT INTO projects(owner_id,name) VALUES($1,'Upgrade fixture') RETURNING *",
      [owner],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO project_members VALUES($1,$2,'owner'),($1,$3,'editor')",
    [project.id, owner, reviewer],
  );
  const body = { name: project.name, description: "" },
    key = token(),
    response = JSON.parse(JSON.stringify(project));
  await pool.query(
    "INSERT INTO idempotency_records(actor_id,key,request_hash,response,status_code) VALUES($1,$2,$3,$4,201)",
    [
      owner,
      key,
      contentHash({ method: "POST", path: "/api/v1/projects", body }),
      response,
    ],
  );
  const fixture = JSON.parse(
      await readFile(
        "../../packages/contracts/fixtures/plan-create.json",
        "utf8",
      ),
    ),
    hash = contentHash(fixture.snapshot);
  const plan = (
    await pool.query(
      "INSERT INTO plan_versions(project_id,number,base_project_version,snapshot,content_hash,created_by) VALUES($1,1,1,$2,$3,$4) RETURNING *",
      [project.id, fixture.snapshot, hash, owner],
    )
  ).rows[0];
  await pool.query("UPDATE plan_versions SET status='in_review' WHERE id=$1", [
    plan.id,
  ]);
  const approval = (
    await pool.query(
      "INSERT INTO approvals(project_id,plan_version_id,user_id,content_hash,decision) VALUES($1,$2,$3,$4,'approved') RETURNING *",
      [project.id, plan.id, reviewer, hash],
    )
  ).rows[0];
  await pool.query("UPDATE plan_versions SET status='approved' WHERE id=$1", [
    plan.id,
  ]);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [reviewer]);
  const job = (
    await pool.query(
      "INSERT INTO operation_jobs(project_id,created_by,kind,status,input) VALUES($1,$2,'planning','queued',$3) RETURNING id",
      [
        project.id,
        owner,
        { prompt: "Legacy pending work", base_project_version: 1 },
      ],
    )
  ).rows[0];
  await migrate(pool);
  await migrate(pool);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM schema_migrations"))
      .rows[0].n,
    4,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT resource_project_id FROM idempotency_records WHERE key=$1",
        [key],
      )
    ).rows[0].resource_project_id,
    project.id,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM approval_revocations WHERE approval_id=$1",
        [approval.id],
      )
    ).rows[0].source,
    "upgrade",
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM operation_jobs WHERE id=$1", [
        job.id,
      ])
    ).rows[0].status,
    "failed",
  );
  assert.equal(
    (
      await pool.query("SELECT content_hash FROM plan_versions WHERE id=$1", [
        plan.id,
      ])
    ).rows[0].content_hash,
    hash,
  );
  records.push({
    name: "Upgrade from exact audit-target migrations preserves immutable history, backfills replay context and fails unverifiable pending work closed",
    status: "PASS",
    migrations: 4,
  });
  app = await buildApp({
    pool,
    secureCookies: false,
    allowedOrigin: "http://localhost:5173",
  });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const login = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const auth = await login.json();
  assert.equal(login.status, 200);
  const headers = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": auth.csrf_token,
    "idempotency-key": key,
    "content-type": "application/json",
  };
  const replay = () =>
    fetch(base + "/api/v1/projects", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const allowed = await replay();
  assert.equal(allowed.status, 201);
  assert.equal((await allowed.json()).id, project.id);
  await pool.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [project.id, owner],
  );
  assert.equal((await replay()).status, 404);
  records.push({
    name: "Backfilled old creation response remains idempotent but rejects revoked-access replay over real HTTP",
    status: "PASS",
  });
} catch (error) {
  records.push({
    name: "Upgrade acceptance",
    status: "FAIL",
    error: error.stack,
  });
  process.exitCode = 1;
} finally {
  await app?.close();
  await pool.end();
  await writeFile(
    (process.env.AUDIT_EVIDENCE_DIR ??
      "../../docs/backend/remediation/current") + "/upgrade.json",
    JSON.stringify({ records }, null, 2) + "\n",
  );
  console.log(JSON.stringify(records, null, 2));
}
