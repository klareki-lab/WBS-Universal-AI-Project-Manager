# G8: UI wording and governance review

The UI presents plan versions, decisions, task assignments and project activity in business language. Technical identifiers, hashes and diagnostic details are collapsed where displayed. Stored project content, activity records, plan snapshots, identifiers and API payloads are not rewritten. An assigned task whose member cannot be resolved is identified as assigned, not as unassigned.

## Governance findings from source review

- Approval remains a human action on the selected plan and its exact content hash; the server verifies both the stored and computed hash. Publication requires an approved, current plan, an authorized human approver and no revocation (`apps/backend/src/domain.ts`).
- The existing backend integration tests cover permanent revocation after disabling an approver, role downgrade and removal (`apps/backend/tests/integration.test.ts`). Those tests were reviewed, not rerun for this UI change.
- The existing G6 report documents that an assigned project member cannot be deleted while referenced by a published task; reassignment requires the plan, approval and publication flow (`docs/G6_RELATIONS.md`). This is a workflow limitation, not a new employee-management implementation.
- The provided request specifies UI wording but gives no employee-management or further governance acceptance criteria. No new personnel-management or authorization behavior is claimed here.

## Verification

Frontend build and unit tests and the local Playwright browser suite use synthetic or controlled fixtures. The browser suite is not evidence of real PostgreSQL, a real AI provider, n8n or MCP execution. No production deployment, communication, or paid AI call is part of this work.
