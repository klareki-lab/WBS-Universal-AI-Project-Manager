The three frozen component branches are integrated into a new isolated G3 worktree with React, the authoritative Fastify/PostgreSQL backend, controlled MCP tools and six executed n8n workflows. Canonical Backend OpenAPI v1.1.0 and P1 are preserved; service membership is explicitly configured and assigned atomically when a human creates a project.

Full-system acceptance is **FAIL / withheld**: deterministic local integration passes, but a real AI-model E2E run is NOT VERIFIED and time-based approval expiry has no definition/implementation in the frozen P1 policy. This draft is reviewable integration work, not a release approval.

Validated:

- Backend 49/49, frontend 29/29, MCP 22/22; all package audits report zero vulnerabilities.
- Real HTTP/MCP/n8n acceptance 22/22, plus six saved successful deterministic workflow executions.
- Actual Chromium fresh-project planning→draft→human approval→publication→persisted Kanban/list/dashboard/activity, independent mobile browser isolation, immutable revisions/rejection/revocation, ambiguous committed response recovery with original key, stale/conflicting writes, expired sessions, and real dedicated-database outage/recovery.
- New G3 PostgreSQL/n8n volumes and loopback runtime; migrations 003/004 verified. A newly built backend container also runs and reports ready.

Exact incorporated commits:

- Backend: a58f6bb8e24e4b13ab8962a088b01106952a59ea
- Frontend: 61f42a1bf71fb9488a768ac80180ce3e84428e5e
- MCP/n8n: 2afcd8264369dc3092fda9c37f0d9d9fb1e6281d

See `docs/integration-g3/REPORT.md`, `COMPATIBILITY.md`, `README.md`, `verification.json` and the redacted evidence directory. Component-only and fixture-only tests are clearly distinguished from actual system execution. Secrets/raw authentication headers remain outside Git. No existing service, production MCP port 8100, agent branch, main branch or production deployment was modified.
