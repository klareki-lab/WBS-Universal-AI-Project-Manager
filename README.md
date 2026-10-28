# WBS Universal AI Project Manager — MCP + Multi-Agent workstream

Independent worktree (`feat/mcp-multiagent`) delivering:

- Custom MCP server **`uapm-mcp`** (TypeScript, SDK v2, Streamable HTTP,
  Zod, Docker) — `apps/mcp-server/`.
- n8n multi-agent orchestration (6 workflows) — `automation/n8n/`.
- Local Docker Compose (MCP + dedicated n8n) — `infra/mcp/`.
- Documentation — `docs/mcp/`, `docs/automation/`.

Entry points:

| What                         | Where                                                 |
| ---------------------------- | ----------------------------------------------------- |
| MCP endpoint (host, dev)     | `http://127.0.0.1:13082/mcp`                          |
| MCP endpoint (container net) | `http://mcp:3002/mcp`                                 |
| Local n8n (dev)              | `http://127.0.0.1:15682`                              |
| Health check                 | `GET /healthz`                                        |

Start:

```bash
cd apps/mcp-server && npm install && npm run build
cp infra/mcp/.env.example infra/mcp/.env   # edit secrets locally
docker compose -f infra/mcp/docker-compose.yml --env-file infra/mcp/.env up --build
```

Tests:

```bash
cd apps/mcp-server
LOG_LEVEL=silent npm test
```

See `docs/mcp/README.md` for the full catalog and architecture, and
`docs/mcp/merge-plan.md` for how this worktree will land in the canonical
`universal-ai-project-manager` repository.
