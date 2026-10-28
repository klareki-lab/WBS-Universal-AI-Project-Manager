# Backend installation and integration

The backend owns `apps/backend`, `packages/contracts`, `infra/backend`, and `docs/backend`. Worktree: `/Users/admin/Projects/uapm-codex`; branch: `feat/backend-core`; repository: `klareki-lab/WBS-Universal-AI-Project-Manager`. The worktree was already initialized at `668dea8eaea0a0122e669c76a360cb1a67e4d4b0`; no canonical repository, remote, other agent branch, or root Compose file was created or changed.

Requires Docker Compose v2 and Node.js 24 LTS. Node 24 support was checked against the [Node release schedule](https://github.com/nodejs/Release). Implementation uses Fastify 5, TypeScript, PostgreSQL 17, Zod 4 and Vitest. Exact dependency versions are locked in `apps/backend/package-lock.json`.

## Start a clean installation

Run from the worktree root. First check `docker ps` and `lsof -nP -iTCP:13081 -iTCP:15439 -sTCP:LISTEN`. If either port belongs to another service, choose unused `BACKEND_PORT` / `POSTGRES_PORT` values in the local environment file. Never stop an unrelated service.

```sh
cp infra/backend/.env.example infra/backend/.env
```

Set `POSTGRES_PASSWORD` to a new random local secret (for example generate it with `openssl rand -hex 24`). Both environment files are ignored by Git; restrict permissions with `chmod 600`. Do not commit real credentials. Passwords containing URL-reserved characters must be percent encoded in DATABASE_URL; a hexadecimal random secret avoids that issue.

```sh
docker compose --env-file infra/backend/.env -f infra/backend/compose.yaml up -d --build
curl --fail http://127.0.0.1:13081/health
curl --fail http://127.0.0.1:13081/ready
```

The server automatically applies ordered SQL migrations under a transaction and advisory lock before listening. PostgreSQL and backend use only the `uapm-dev` project, `uapm-dev_postgres-data` volume, and `uapm-dev_backend` network. Default bindings are 127.0.0.1:13081→3001 and 127.0.0.1:15439→5432. There is no n8n service or MCP server in this Compose file. No production system is required.

## Create the first human user

Provisioning is an administrative CLI, not an unauthenticated registration endpoint. Supply `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 12 characters using your local shell/secret manager. Do not put passwords into tracked commands or files.

```sh
docker compose --env-file infra/backend/.env -f infra/backend/compose.yaml exec \
  -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD backend \
  node dist/apps/backend/src/admin.js create-user
```

Login: `POST /api/v1/auth/login` with `{email,password}`. Keep the HttpOnly cookie and returned `csrf_token`. Every authenticated browser mutation requires `X-CSRF-Token`; every domain mutation also requires `Idempotency-Key` (8–200 alphanumeric/underscore/dot/colon/hyphen characters). GET `/api/v1/auth/me` or `/auth/session` validates authentication. POST `/auth/logout` revokes the session. Login/logout are session lifecycle actions and do not use domain idempotency records.

The default allowed browser origin is `http://localhost:5173`. Set `ALLOWED_ORIGIN` to the frontend's exact origin. Cookies are SameSite=Strict: use matching hostnames for frontend and backend in browser development (`localhost` on both, or `127.0.0.1` on both). Local Compose explicitly uses COOKIE_SECURE=false; set true with HTTPS. Source server defaults to secure cookies.

## Local source development

```sh
cd apps/backend
npm ci
cp .env.example .env
```

Set DATABASE_URL and TEST_DATABASE_URL to the isolated local PostgreSQL credentials. Keep the application database `uapm` separate from `uapm_test`.

```sh
node --env-file=.env node_modules/tsx/dist/cli.mjs src/migrate.ts
node --env-file=.env node_modules/tsx/dist/cli.mjs src/server.ts
```

Use host port 13081 only when the Compose backend is not already bound there. `npm run build` compiles TypeScript; `npm start` starts compiled code. `npm run dev` watches source and expects environment variables exported by the caller.

## Automated verification

Create the test database once inside this project's container:

```sh
docker compose --env-file infra/backend/.env -f infra/backend/compose.yaml exec -T postgres \
  psql -U uapm -d postgres -c 'CREATE DATABASE uapm_test'
cd apps/backend
npm run typecheck
npm run contracts
node --env-file=.env node_modules/vitest/vitest.mjs run
npm run build
npm audit
```

Tests intentionally truncate only the dedicated `uapm_test` database's application tables. They refuse other database names and nonlocal hostnames. Do not run two integration suites against the same test database simultaneously. Tests start real HTTP listeners on ephemeral localhost ports, apply real PostgreSQL migrations and exercise durable database state. Unit-only success is not considered integration evidence.

`packages/contracts/fixtures/plan-create.json` contains a realistic 12-task, 3-phase plan with dependencies. Missing assignees, confirmed dates and effort remain null. The smoke/seed command demonstrates the running container API and SQL state without using production data:

```sh
# From apps/backend, after configuring .env and starting Compose:
node --env-file=.env node_modules/tsx/dist/cli.mjs src/smoke.ts
```

It provisions an isolated local fixture identity, creates two projects, saves/reviews/approves/publishes the 12-task fixture, repeats publish, updates task progress, and verifies SQL counts. It preserves the demonstration projects in the application database. It writes sanitized HTTP/SQL evidence to `docs/backend/evidence-smoke.json` and domain response examples to `packages/contracts/fixtures/example-responses.json`. By default credentials are random and never printed; to provision a reusable demo user, supply ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME explicitly. Reusing an existing email fails safely rather than replacing an account.

## Service identity and n8n

After creating a project, provision a dedicated service token. Supply SERVICE_NAME, SERVICE_PROJECT_ID, SERVICE_SCOPES (`read,plans:write,operations:write` by default). The CLI prints the token once; store it in MCP/n8n secrets. It expires after 90 days. It never contains database credentials.

```sh
docker compose --env-file infra/backend/.env -f infra/backend/compose.yaml exec \
  -e SERVICE_NAME -e SERVICE_PROJECT_ID -e SERVICE_SCOPES backend \
  node dist/apps/backend/src/admin.js create-service
```

The service is an editor only on the specified project. Add `plans:publish` only when approved publication automation is required. No service can approve, change project ownership, create users/projects, or change task status. A service with publication scope can publish only an already human-approved exact version.

Set N8N_ENDPOINT to one fixed, trusted internal HTTP URL and N8N_TOKEN to a separate outbound adapter secret. The backend polls durable planning jobs when configured. No endpoint URL comes from model input or browser requests. Asynchronous callbacks use a different backend service identity token, not N8N_TOKEN. See `integration.md` for the exact adapter contract.

Disable a user/service with the administrative CLI `disable-user` and USER_ID. This revokes sessions and prevents further token authentication. Provision a replacement service token to rotate an identity.

## Stop this stack

```sh
docker compose --env-file infra/backend/.env -f infra/backend/compose.yaml stop
```

This preserves data. No broad Docker cleanup is needed. Database backups and any eventual destructive data removal are operator responsibilities outside this assignment.
