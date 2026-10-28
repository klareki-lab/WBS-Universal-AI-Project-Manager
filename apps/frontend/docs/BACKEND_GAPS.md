# Backend contract gaps — Klare KI / Astra frontend

Canonical source: Codex feat/backend-core packages/contracts/openapi.yaml (v1.0.0). These are API/product gaps, not permission to implement server logic in the browser.

1. **Create native task without a plan:** UI allows user-directed task entry on a new project. Current POST tasks missing. Decide if direct tasks are allowed under backend approval rules. Acceptance: authenticated request is persisted, audited, project scoped, optimistic versioned, idempotent, and visible after reload; or clearly reject as product policy.
2. **Edit existing plan drafts:** structured plan editor needs server-created immutable revised version from task edits. Current createPlan/proposeChanges requires full validated snapshot and project base version. Acceptance: define approved edit/rebase behavior and conflict handling; UI must never modify stored snapshot.
3. **Plan diff and approval history:** no dedicated comparison/approval listing in v1. Acceptance: server returns exact baseline-to-candidate differences, reviewer identities and decisions, or approve documented client-computation using trusted snapshots.
4. **Project metadata:** project category, target date, budget and constraints have no canonical fields. Acceptance: add validated optional fields with persistence and migration or explicitly remove product requirement.
5. **Session/CSRF after reload:** GET auth/session does not return CSRF. A page reload preserves cookie but not write permission. Acceptance: CSRF bootstrap/re-auth endpoint under authenticated human scope, or explicit required re-login; never expose session cookie to JS.
6. **AI conversation response:** existing planningRequest returns durable operation only. Read-only agent Q&A, clarification, conversation history and proposals listing aren't exposed. Acceptance: define authenticated conversation/message and proposal lifecycle or disable those controls in live mode.
7. **Safe mutation recovery:** idempotency keys replay backend responses, but no lookup by key. Acceptance: choose persistent client key or server-side key status lookup to distinguish unknown outcome after restart.
8. **Build gate:** frontend package-lock is missing. Frontend owner must run npm install --package-lock-only against npm registry, commit resulting lock, then npm ci/typecheck/test/build before merging.

No MCP/n8n operations are required to test backend-only login, project, plans, publication, tasks and audit.
