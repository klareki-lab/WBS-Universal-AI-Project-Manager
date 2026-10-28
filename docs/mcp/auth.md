# Authentication

The MCP server uses a static service token for the service-to-service hop
and expects the caller to carry an **on-behalf-of** principal that the
backend will validate against its own user model.

## Required headers

| Header               | Required | Purpose                                                 |
| -------------------- | -------- | ------------------------------------------------------- |
| `Authorization`      | yes      | `Bearer <UAPM_MCP_SERVICE_TOKEN>` (or `x-service-token`) |
| `x-on-behalf-of`     | yes for user context | Stable user ID the agent acts for          |
| `x-correlation-id`   | recommended | UUID for tracing; server generates if omitted         |
| `x-service-subject`  | optional | Service identity (e.g. `n8n-wf-02`)                    |

A missing or wrong service token returns HTTP 401 at the HTTP layer, before
the MCP transport is even initialized.

## Backend auth

The MCP server attaches:

```
x-service-token: <UAPM_BACKEND_SERVICE_TOKEN>
x-on-behalf-of: <userId>
x-correlation-id: <uuid>
idempotency-key: <provided by client>
```

The backend MUST:

- Validate the service token (service identity).
- Validate that the `on-behalf-of` user has access to the project.
- Enforce approval policy independently of agent prompts.
- Reject writes that lack idempotency keys.

The MCP server never trusts the on-behalf-of header on its own as proof
of user authorization — it only forwards it for backend validation.

## Token rotation

Tokens are environment variables:

- `UAPM_MCP_SERVICE_TOKEN` — client → MCP
- `UAPM_BACKEND_SERVICE_TOKEN` — MCP → backend

Rotate by changing the env and restarting the service (and all clients).
Do **not** commit tokens.
