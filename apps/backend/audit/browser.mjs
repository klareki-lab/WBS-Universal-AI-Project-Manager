import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { makePool } from "../dist/apps/backend/src/db.js";
import { buildApp } from "../dist/apps/backend/src/app.js";
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
const dir =
  process.env.AUDIT_EVIDENCE_DIR ?? "../../docs/backend/remediation/current";
const db = makePool(
  process.env.AUDIT_DATABASE_URL ??
    "postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation",
);
const doc = parse(
  await readFile("../../packages/contracts/openapi.yaml", "utf8"),
);
const app = await buildApp({
  pool: db,
  secureCookies: false,
  allowedOrigin: "http://localhost:26482",
});
await app.listen({ host: "127.0.0.1", port: 26481 });
const frontend = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(
    "<!doctype html><title>Isolated browser acceptance fixture</title><main>KI Project Studio authentication probe</main>",
  );
});
await new Promise((r) => frontend.listen(26482, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
});
const records = [];
async function flow(host, identity = 0) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://localhost:26482/");
  const value = await page.evaluate(
    async ({ host, identity }) => {
      const api = `http://${host}:26481`;
      const response = await fetch(api + "/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `synthetic-audit-${identity}@example.invalid`,
          password: "SYNTHETIC-Audit-Only-2026!",
        }),
      });
      const login = await response.json();
      const me = await fetch(api + "/api/v1/auth/me", {
        credentials: "include",
      });
      let project = null;
      if (me.ok) {
        const r = await fetch(api + "/api/v1/projects", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": login.csrf_token,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ name: "Browser acceptance " + identity }),
        });
        project = { status: r.status, id: (await r.json()).id };
      }
      return {
        login: response.status,
        me: me.status,
        project,
        request_id: me.headers.get("x-request-id"),
      };
    },
    { host, identity },
  );
  return { context, page, value };
}
try {
  const host = new URL(doc.servers[0].url).hostname;
  const a = await flow(host);
  records.push({
    name: "Documented default API hostname authenticates and mutates from default frontend site",
    status:
      a.value.login === 200 &&
      a.value.me === 200 &&
      a.value.project?.status === 201
        ? "PASS"
        : "FAIL",
    api_hostname: host,
    ...a.value,
  });
  if (a.value.me === 200) {
    await a.page.reload();
    const reload = await a.page.evaluate(async (host) => {
      const api = `http://${host}:26481`;
      const session = await fetch(api + "/api/v1/auth/session", {
        credentials: "include",
      });
      const csrf = await fetch(api + "/api/v1/auth/csrf", {
        credentials: "include",
      });
      const body = await csrf.json();
      let status = null;
      if (csrf.ok) {
        const r = await fetch(api + "/api/v1/projects", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": body.csrf_token,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ name: "After browser refresh" }),
        });
        status = r.status;
      }
      return {
        session: session.status,
        bootstrap: csrf.status,
        mutation: status,
      };
    }, host);
    records.push({
      name: "Reload obtains CSRF without exposing HttpOnly session and can mutate",
      status:
        reload.session === 200 &&
        reload.bootstrap === 200 &&
        reload.mutation === 201
          ? "PASS"
          : "FAIL",
      ...reload,
    });
  }
  const other = await flow("localhost", 1);
  const cross = a.value.project?.id
    ? await other.page.evaluate(async (id) => {
        const r = await fetch(`http://localhost:26481/api/v1/projects/${id}`, {
          credentials: "include",
        });
        return r.status;
      }, a.value.project.id)
    : null;
  records.push({
    name: "Independent browser storage preserves project isolation",
    status:
      cross === null
        ? "SKIP"
        : other.value.project?.status === 201 && cross === 404
          ? "PASS"
          : "FAIL",
    cross_project_status: cross,
  });
  const negative = await flow("127.0.0.1");
  records.push({
    name: "Cross-site hostname remains blocked by Strict cookie policy",
    status:
      negative.value.login === 200 && negative.value.me === 401
        ? "PASS"
        : "FAIL",
    ...negative.value,
  });
  await Promise.all([
    a.context.close(),
    other.context.close(),
    negative.context.close(),
  ]);
} finally {
  await browser.close();
  await app.close();
  await db.end();
  await new Promise((r) => frontend.close(r));
}
await writeFile(
  dir + "/browser.json",
  JSON.stringify({ browser: chromium.name(), records }, null, 2) + "\n",
);
console.log(JSON.stringify(records, null, 2));
