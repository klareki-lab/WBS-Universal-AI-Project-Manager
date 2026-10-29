# uapm-mcp — Universal AI Project Manager MCP Server

Custom Model Context Protocol server for the Universal AI Project Manager (UAPM).
Technology: TypeScript, Node.js 20+, MCP SDK v2 (`@modelcontextprotocol/sdk`),
Zod, Streamable HTTP transport, Express, Pino, Docker.

Service is deliberately independent of the shared Klare KI MCP (port 8100): it has
its own name, port, credentials, Docker network and n8n instance.

## Endpoints and ports

| Context                | Address                               |
| ---------------------- | ------------------------------------- |
| Container internal     | `http://mcp:3002/mcp`                 |
| From the host (dev)    | `http://127.0.0.1:13082/mcp`          |
| Health check           | `GET /healthz`                        |
| Local n8n (dedicated)  | `http://127.0.0.1:15682` (admin UI)   |

The MCP endpoint is not exposed publicly during development. Keep binding on
`127.0.0.1`.

## Architecture

```
MCP client (n8n agent / IDE / CLI)
       │  Bearer <service token>   x-on-behalf-of: <userId>
       ▼
uapm-mcp server (Streamable HTTP + SDK v2)
       │  service auth, correlation ID, retry policy
       ▼
Universal AI PM Backend API  ◄──── sole writer to PostgreSQL
       │
       ▼
PostgreSQL (owned by the backend, never by MCP)
```

MCP never talks to the database directly. All write permissions, approvals
and idempotency checks are enforced by the backend.

While the real backend is being built, the server ships a contract-compatible
in-memory mock (`src/mock/backend.ts`) selected by `UAPM_BACKEND_MODE=mock`.

## Running locally

```bash
cd apps/mcp-server
npm install
npm run build
UAPM_BACKEND_MODE=mock \
UAPM_MCP_SERVICE_TOKEN=dev-local \
LOG_LEVEL=info \
npm start
```

Or with Docker Compose (`infra/mcp/`):

```bash
cp infra/mcp/.env.example infra/mcp/.env   # edit secrets locally
docker compose -f infra/mcp/docker-compose.yml --env-file infra/mcp/.env up --build
curl -s http://127.0.0.1:13082/healthz
```

## Authentication

Clients must send a service token on every request:

```
Authorization: Bearer <UAPM_MCP_SERVICE_TOKEN>
```

For on-behalf-of calls (agents acting for a user) attach:

```
x-on-behalf-of: user_<id>
x-correlation-id: <uuid>
x-service-subject: uapm-mcp-client
```

The backend independently validates authorization. The MCP server does not
accept arbitrary user-asserted identities as trusted authorization.

## Tool / resource / prompt catalogs

See:

- [`tools.md`](./tools.md) — 16 tools, inputs/outputs, backend mappings.
- [`resources.md`](./resources.md) — `project://{id}/overview` and `project://{id}/plan/current`.
- [`prompts.md`](./prompts.md) — `plan_project`, `review_project_plan`.
- [`auth.md`](./auth.md) — token model, principal headers, scopes.
- [`failure-recovery.md`](./failure-recovery.md) — timeouts, retries, idempotency.
- [`security.md`](./security.md) — permission model, redaction, limitations.

## Local client example

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://127.0.0.1:13082/mcp"),
  {
    requestInit: {
      headers: {
        authorization: `Bearer ${process.env.UAPM_MCP_SERVICE_TOKEN}`,
        "x-on-behalf-of": "user_demo",
      },
    },
  },
);
const client = new Client({ name: "example", version: "0.0.1" });
await client.connect(transport);
console.log(await client.listTools());
```

## Tests

```bash
cd apps/mcp-server
LOG_LEVEL=silent npm test
```

The suite covers initialization, tool discovery, 16 schemas, read access,
cross-project denial, the full planner → reviewer → draft → approval →
publish → progress → task-update flow, idempotency, invalid transitions,
stale version checks and log-redaction.

## Known limitations

- Mock backend persists in process memory only. Restart loses state.
- Human approval is simulated via `backend.approvePlanAsHuman()` in tests.
  Production approvals are issued through the backend's human review UI.
- No destructive tools in v1 (deletion is out of scope).
- Rate limiting from the backend is passed through with `rate_limited`;
  the MCP server does not add its own rate limiter yet.
- Workspace lives in `uapm-cc` worktree until the canonical repository
  `/Users/admin/Projects/universal-ai-project-manager/` is initialized.
  See `docs/mcp/merge-plan.md`.
