# Canonical backend contract v1.0.0

- `openapi.yaml`: OpenAPI 3.1 paths, request/response schemas, authentication and scope metadata.
- `schemas/`: standalone JSON Schema 2020-12 artifacts.
- `types.ts`: generated TypeScript `paths`, `operations`, and `components` types.
- `fixtures/plan-create.json`: realistic 12-task/3-phase request, with unresolved fields null.
- `fixtures/example-responses.json`: sanitized domain responses captured from the running Docker backend.

Generated from backend Zod schemas and the route registry with `cd apps/backend && npm run contracts`. Do not edit generated files independently. Inputs are strict; server-normalized defaults are included in saved snapshots. Some relational invariants (cycle detection, date ordering, project membership and optimistic versions) are enforced in code/database and cannot be expressed fully by JSON Schema.

For Astra and Claude Code, use [integration instructions and MCP operation mapping](../../docs/backend/integration.md). Material task metadata PATCH creates a **PlanVersion** (201) and needs human review/approval/publication. No service has approval permission. The OpenAPI extensions `x-human-only` and `x-required-service-scopes` are normative authorization metadata in addition to the security schemes.

Hash values are computed by the server over normalized snapshots with recursively sorted object keys (UTF-16 code-unit order), JSON serialization and SHA-256. Treat returned hashes as opaque approval tokens; approve the exact saved version rather than hashing the original, potentially unnormalized request.

Contract changes require updating [the changelog](../../docs/backend/CONTRACT_CHANGELOG.md) and regenerating artifacts. Do not rename fields or status enums silently.
