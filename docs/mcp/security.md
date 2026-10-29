# Security model and permissions

## Trust boundaries

```
┌────────────────────────────┐  trusted
│ Operator / human reviewer  │
├────────────────────────────┤
│ UAPM backend + database    │  trusted (owns writes, approvals)
├────────────────────────────┤  ← MCP server lives here; adapter only
│ uapm-mcp                   │
├────────────────────────────┤  semi-trusted (service identity)
│ n8n orchestration layer    │
├────────────────────────────┤  untrusted
│ AI agents / LLMs           │
└────────────────────────────┘
```

The MCP server is an **adapter**, not a source of truth. It must not
make policy decisions that override the backend.

## What the MCP server enforces

- Service token presence and value.
- Request/response size via `express.json({ limit: "2mb" })`.
- Timeouts, retries, idempotency key presence.
- Structured JSON logging with secret redaction (`authorization`, `token`,
  `password`, `secret`, `api_key`).
- Mapping backend errors to typed MCP error codes.

## What the backend MUST enforce (not the MCP server)

- Who may read which project / task.
- Who may approve plan versions.
- That `publish_approved_plan` only accepts plans with a human approval.
- That `update_task` high-impact fields require an approved proposal.
- Operation deduplication by `idempotencyKey`.
- Data retention and GDPR concerns.

## Agent cannot approve plans

The MCP tool `request_plan_approval` only **creates a pending request**.
There is no MCP tool that approves a plan on behalf of a user. The backend
must only accept approvals through its human review UI.

## No destructive tools in v1

`delete_project`, `delete_task`, `cancel_published_plan` etc. are
intentionally omitted. Add them in a later version only with a separate
threat model.

## Known limitations

- Mock backend accepts any `x-on-behalf-of` user ID as the user. The real
  backend MUST actually validate this.
- The MCP service token is a long-lived shared secret. Prefer per-service
  tokens and short rotation windows when productionizing.
- There is no per-tool rate limiting at the MCP layer yet.
- No audit log is written by the MCP server; the backend's activity log
  (`list_activity_history`) is the audit record.
