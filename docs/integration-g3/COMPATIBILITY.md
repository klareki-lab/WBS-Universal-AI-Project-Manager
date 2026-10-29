# G3 compatibility and integration preparation

Remote refs fetched 2026-10-28. All three heads exactly match the frozen candidates; no later commits observed. Base main: 668dea8eaea0a0122e669c76a360cb1a67e4d4b0. History-preserving merges in new worktree `/Users/admin/Projects/uapm-integration-g3`, branch `feat/integration-g3`. No file merge conflicts. Source working directories were not modified.

| Component | Incorporated commit |
| --- | --- |
| Backend | a58f6bb8e24e4b13ab8962a088b01106952a59ea |
| React frontend | 61f42a1bf71fb9488a768ac80180ce3e84428e5e |
| MCP/n8n | 2afcd8264369dc3092fda9c37f0d9d9fb1e6281d |

Inspected backend initial and remediation handovers, frontend root handover plus LIVE_INTEGRATION and QA/build reports, MCP integration-evidence and compatibility-matrix, automation workflow architecture, and canonical OpenAPI v1.1.0. The root frontend handover describes an older demo delivery; current source includes a partial live adapter. Earlier MCP evidence targets backend 7faca55, not the frozen remediated backend.

| Actual mismatch | Integration resolution |
| --- | --- |
| Frontend assumes no CSRF bootstrap and blocks writes after reload | GET auth/session followed by GET auth/csrf; token remains tab memory |
| Natural-language project creation always sends unsupported deadline | Live creation omits unsupported deadline; structured unsupported inputs disabled |
| No live approval history; plan revision methods deliberately unsupported | Live plan workspace uses canonical immutable createPlan, submitReview, approvalHistory, decidePlan, revokeApproval and publishPlan |
| Existing workspace requires a plan before allowing planning | Live workspace allows a fresh project to enqueue planning with no plan |
| Ambiguous writes discard random key | Store only request fingerprint/key in sessionStorage; explicit identical retry reuses it after reload |
| MCP get_task/get_plan_version/approval/publication omit project scope | Tool schemas require projectId plus child IDs; publication requires hash |
| MCP refetches current base on every proposal | Tool caller supplies original baseProjectVersion; no rebasing of delayed work |
| MCP change-proposal sends rationale rather than required reason | Map to canonical reason |
| MCP update_task refuses operation; original tool promises direct edits | Creates draft through taskMetadata; response explicitly requires approval |
| MCP dashboard ignores canonical by_status and publish assumes task_ids array rather than map | Map actual by_status and task ID map; regression checks include real persisted counts |
| MCP sends JSON headers on bodyless approval/review POSTs | Set Content-Type only when a body exists |
| MCP synthesizes approval from status alone | Read immutable decision + revocation history; publication still checked by backend |
| Missing submit-review and strict callback tools | Add submit_review and store_agent_result; validate project/original base, retain request identity |
| n8n calls a nonexistent MCP /call-tool facade | Authenticated SDK facade dispatches through the real MCP catalog and HTTP backend |
| Worker sends operation/provenance; n8n expects chat packet | WF-01 validates and normalizes original worker packet; callback preserves operation and base |
| Incomplete switch routes, unsafe error fallthrough, missing scoped arguments | Repair routing; fail closed before executor; pass project IDs and exact hash |
| Importable workflows still have unresolved AI credentials and trigger schemas | Explicit fixture profile strips AI nodes; passthrough subworkflow triggers; stable workflow IDs |

Canonical backend v1.1.0 and P1 policy remain unchanged. MCP tool inputs are intentionally incompatible with earlier single-ID calls; failures must be explicit. The facade is additive, not another domain API/database. AI output is a proposal and never invokes decidePlan. n8n execution metadata resides only in its dedicated volume.

G3 ports are 25173 React, 23081 backend, 23082 MCP, 25682 n8n, 25439 PostgreSQL, all host bindings loopback. Human browser origins use `localhost` exclusively. Containers use `host.docker.internal` for host apps; PostgreSQL container has its own volume and no external database configuration. Migrations 001–004 are applied by the unchanged backend only to `uapm_g3`; the backend suite resets only `uapm_test` in the same newly created G3 container.

Validation plan: clean npm installs/static builds; backend HTTP/PostgreSQL suite; MCP schema and real HTTP tests; deterministic execution of all six n8n workflows; Chromium fresh-project lifecycle with independent actor storage and mobile viewport; negative authorization/revocation/stale/retry checks; SQL migration/provenance verification. A real AI request is a separate gate and cannot pass without a securely configured credential and actual execution.

Dependency audit remediation: MCP Zod upgraded from vulnerable 3.x to 4.6.7; dictionary schemas adapted explicitly (partial enum record for sparse task counts). This is a validation-library security update, not a backend contract or architecture change.

Final authorization wiring: optional AUTOMATION_SERVICE_ID grants only the configured service membership in new projects, atomically with human project creation and an immutable automation.member_assigned event. No domain response/schema or P1 changes. Integration tests prove service scope, unrelated-project denial and rollback for missing/human configured identities. The G3 business scenario now needs no post-creation fixture enrollment.
