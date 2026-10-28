# Contract changelog

## 1.0.0 — 2026-10-28

Initial canonical `/api/v1` contract. snake_case domain fields; camelCase OpenAPI path parameter identifiers. Fixed project/task/plan statuses match the assignment. IDs are UUIDs, timestamps ISO 8601 UTC and task dates ISO calendar dates. Unknown input fields fail. Task metadata PATCH returns an immutable plan proposal requiring human approval and publish. Login/logout use session semantics; all other mutations require Idempotency-Key. Service scopes and human-only rules are part of the contract.
