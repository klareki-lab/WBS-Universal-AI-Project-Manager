# Open Questions for Backend Lead (integration gate)

1. **Identity & tenancy:** OAuth/session mechanism, tenant/project authorization, role permissions, CSRF protection, and how to resolve the current actor? No credentials in browser bundles.
2. **Routes & methods:** What are canonical routes, HTTP verbs, pagination and shape of resource envelopes? Confirm server DTOs vs `src/api/types.ts`.
3. **Plan concurrency:** What is the version ID format, ETag/revision policy, optimistic conflict response (`409`), and clone-on-edit API? Must preserve old snapshots.
4. **Approval:** Who may approve, is there a two-person rule, is a signature required, and does approval freeze plan and task payload atomically? Can approvals be revoked?
5. **Workflow after approval:** What operation creates a new draft from an approved snapshot? What happens to existing Jira issues across revisions?
6. **AI planning:** Chat session IDs, message history, user edits vs model suggestions, streaming protocol, cancellation, costs/quotas, safety/validation and source attribution?
7. **Project creation:** Does `createProject` start an async planning job, or return an initial plan synchronously? How will progress/errors be surfaced?
8. **Dependencies:** Are cross-project dependencies supported? Must DAG cycles be validated server-side? Who handles scheduling from constraints and dates?
9. **Jira setup:** Cloud vs Data Center, account/workspace selection, OAuth scopes, project key, issue types, required custom fields, per-project mapping and credentials storage?
10. **Sync protocol:** Idempotency key definition (project + planVersion + operation?), queue semantics, retry/backoff, cancellation, partial reconciliation and dead-letter handling?
11. **Issue references:** Canonical validation of Jira browse URLs and issue keys, and task-to-issue mapping across plan versions? Frontend never fabricates links.
12. **Audit & notifications:** Event actor, timestamp source, retention, immutable audit trail, real-time SSE/WebSocket vs polling, job result pagination and safe retry messages?
13. **Localization & accessibility:** Backend error codes for translation; supported locales; long-running job announcements; role-sensitive navigation and data redaction?
14. **Definition of ready:** Which staging services, contract fixtures, failure scenarios and acceptance tests must pass before enabling any real sync action?

**No endpoint is considered approved until reconciled with the Backend Lead.**
