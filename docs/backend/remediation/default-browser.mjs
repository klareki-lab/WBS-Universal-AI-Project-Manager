// Verification artifact only; the backend runtime tree is unchanged.
// From apps/backend: node --env-file=.env ../../docs/backend/remediation/default-browser.mjs
// Set CHROMIUM_EXECUTABLE to an installed Chromium, or PLAYWRIGHT_BROWSERS_PATH
// to the project-local browser directory described in README.md.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { makePool } from "../../../apps/backend/dist/apps/backend/src/db.js";
import {
  passwordHash,
  token,
} from "../../../apps/backend/dist/apps/backend/src/security.js";
const require = createRequire(
  new URL("../../../apps/backend/package.json", import.meta.url),
);
const { chromium } = require("playwright"),
  { parse } = require("yaml");
const api = parse(
  await readFile(
    new URL("../../../packages/contracts/openapi.yaml", import.meta.url),
    "utf8",
  ),
).servers[0].url;
assert.equal(api, "http://localhost:13081");
assert.equal(process.env.ALLOWED_ORIGIN, "http://localhost:5173");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "15439");
assert.equal(url.pathname, "/uapm");
assert.equal(
  execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      "uapm-dev-postgres-1",
    ],
    { encoding: "utf8" },
  ).trim(),
  "uapm-dev",
);
const db = makePool(url.href),
  email = `browser-default-${randomUUID()}@example.invalid`,
  password = token();
await db.query(
  "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'Default browser fixture','human',$2)",
  [email, await passwordHash(password)],
);
const frontend = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end("<!doctype html><title>Default browser origin verification</title>");
});
await new Promise((r) => frontend.listen(5173, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
});
let report;
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto("http://localhost:5173");
  const login = await page.evaluate(
    async ({ api, email, password }) => {
      const r = await fetch(api + "/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return { status: r.status, request_id: r.headers.get("x-request-id") };
    },
    { api, email, password },
  );
  assert.equal(login.status, 200);
  await page.reload();
  const reload = await page.evaluate(async (api) => {
    const session = await fetch(api + "/api/v1/auth/session", {
        credentials: "include",
      }),
      bootstrap = await fetch(api + "/api/v1/auth/csrf", {
        credentials: "include",
      });
    const csrf = (await bootstrap.json()).csrf_token;
    const project = await fetch(api + "/api/v1/projects", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ name: "Default-origin browser persistence" }),
    });
    const body = await project.json();
    const read = await fetch(api + "/api/v1/projects/" + body.id, {
      credentials: "include",
    });
    await fetch(api + "/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": csrf },
    });
    return {
      session: session.status,
      bootstrap: bootstrap.status,
      mutation: project.status,
      reloaded_project: read.status,
      project_id: body.id,
      request_id: project.headers.get("x-request-id"),
    };
  }, api);
  assert.deepEqual(
    [
      reload.session,
      reload.bootstrap,
      reload.mutation,
      reload.reloaded_project,
    ],
    [200, 200, 201, 200],
  );
  assert.equal(
    (await db.query("SELECT 1 FROM projects WHERE id=$1", [reload.project_id]))
      .rowCount,
    1,
  );
  report = {
    status: "PASS",
    name: "Actual default localhost:5173 browser → localhost:13081 Docker API, reload/bootstrap/mutation and SQL persistence",
    executed_at: new Date().toISOString(),
    api,
    frontend: "http://localhost:5173",
    login,
    ...reload,
    frontend_ui: "synthetic fixture, not Astra UI",
  };
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => frontend.close(r));
  await db.end();
}
await writeFile(
  new URL("./current/default-browser.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
