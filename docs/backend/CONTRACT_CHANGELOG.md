# Contract changelog

## 1.0.0 — 2026-10-28

Initial canonical `/api/v1` contract. snake_case domain fields; camelCase OpenAPI path parameter identifiers. Fixed project/task/plan statuses match the assignment. IDs are UUIDs, timestamps ISO 8601 UTC and task dates ISO calendar dates. Unknown input fields fail. Task metadata PATCH returns an immutable plan proposal requiring human approval and publish. Login/logout use session semantics; all other mutations require Idempotency-Key. Service scopes and human-only rules are part of the contract.

## 1.1.0 — 2026-10-28 audit remediation RC

Canonical browser API hostname is localhost, matching the default frontend origin; cookie/Origin/CSRF protections remain intact. Adds human GET /auth/csrf bootstrap and immutable approval history/revocation endpoints. Defines permanent revocation of pending approvals on disable/removal/downgrade, preserving consumed history. Adds operation request_id/context_hash and plan origin_operation_id provenance fields. Persisted text excludes NUL and unpaired surrogates. Callback result/error is a strict exclusive union matching previous intended runtime behavior; its body shape and scopes are unchanged. Stale/re-labeled operations now fail 409; legacy pending operations fail closed during upgrade. Idempotent replay requires current authorization including project creation. Database outage responses are bounded sanitized 503 with no implicit mutation retries.
