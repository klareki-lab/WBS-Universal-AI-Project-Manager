> Historical preparation record. Current real-AI acceptance and owner decisions: [FINAL.md](FINAL.md).

# G3 full-system acceptance report

**Current verdict: CONDITIONAL PASS — external owner actions remain; final release acceptance is withheld.** The deterministic product integration passes. Genuine AI execution is **NOT VERIFIED** because explicit owner expense authorization and P1 ratification remain unrecorded. The sandbox credential has since been supplied and confirmed by metadata-only check; no provider request was made. Time-based approval expiry is **out of scope for the G3 MVP**, subject to Product Owner ratification. See [G3-FINAL acceptance and blockers](FINAL.md). This is not a PASS of the real-AI gate.

The results below are the preserved baseline at `7beaf1ca91396e63ca6b9645a736f994c14c0379`; new profile evidence is reported separately in FINAL.md.

Worktree: `/Users/admin/Projects/uapm-integration-g3` · branch: `feat/integration-g3` · verified integration code commit: `a80516e959af745470fae27e49229a46e5784c01`. The final branch head also contains this report and redacted evidence. No main merge or production deployment occurred.

## Exact integrated sources

| Source | Incorporated SHA |
| --- | --- |
| main base | 668dea8eaea0a0122e669c76a360cb1a67e4d4b0 |
| feat/backend-core | a58f6bb8e24e4b13ab8962a088b01106952a59ea |
| feat/frontend | 61f42a1bf71fb9488a768ac80180ce3e84428e5e |
| feat/mcp-multiagent | 2afcd8264369dc3092fda9c37f0d9d9fb1e6281d |

Remote refs were fetched and checked before creating the worktree, and rechecked on 2026-10-29. No later component commits were observed. Three non-fast-forward merges preserve all source histories; no file conflicts required resolution. Component branches were not rebased, rewritten or modified. [Compatibility report](COMPATIBILITY.md) records the payload and runtime changes; [baseline/failure record](BASELINE.md) preserves failed attempts and their causes.

Backend OpenAPI remains **v1.1.0, 28 paths, 33 operations, 43 schemas**. Contract regeneration leaves packages/contracts unchanged. Migrations and P1 approval policy are unchanged. The backend addition is optional, explicitly configured automation membership: human project creation atomically assigns the configured service and records an immutable event. Missing/human configured identities fail atomically. A service still cannot approve or impersonate the human creator.

## Acceptance results

| Gate | Result and evidence |
| --- | --- |
| Clean installation/static verification | npm ci for all packages; TypeScript/builds, backend Prettier and contract generation PASS. No package exposes a lint script, so no nonexistent lint command is claimed. |
| Backend HTTP/PostgreSQL suite | **49/49 PASS** in the dedicated uapm_test database, including three added configured-service assignment/rollback cases. [Log](evidence/backend-tests.log) |
| Frontend unit/transport suite | **29/29 PASS**, including session/CSRF restoration and retained-key ambiguous retry. [Log](evidence/frontend-tests.log) |
| MCP component/contract suite | **22/22 PASS**. The optional original real-backend suite is skipped without its environment; it is not counted as real-system evidence. [Log](evidence/mcp-tests.log) |
| Real G3 HTTP/MCP/n8n acceptance | **22/22 PASS** against the running backend and PostgreSQL: scopes, project isolation, bodyless review/approval requests, hash checks, executor publication/replay, persisted dependencies, draft-only task proposals, stale/concurrent writes, revocation, callback union/base and expired credentials. [Evidence](evidence/http.json) |
| Chromium full business scenario | **13/13 checks PASS**, with actual React, shared PostgreSQL, n8n and MCP. Two Chromium processes use independent storage; the second uses a 390×844 mobile viewport. [Evidence](evidence/browser.json) |
| Chromium immutable revision / rejection / P1 history | **4/4 PASS**, including reload of permanent revocation history and disabled publication. [Evidence](evidence/browser-policy.json) |
| Chromium ambiguous committed response | **3/3 PASS**. The first real project creation commits, its response is aborted, reload restores CSRF, and an explicit identical retry reuses the original key and recovers the original project; SQL confirms one row. [Evidence](evidence/browser-retry.json) |
| Chromium stale/conflicting/expired session | **3/3 PASS** using actual backend responses and a dedicated synthetic session. A concurrent project change yields displayed 409; concurrent browser mutations yield one 200 and one 409; expired cookies return to login. [Evidence](evidence/browser-errors.json) |
| Actual database outage in Chromium | **2/2 PASS**. Only G3 PostgreSQL is stopped; readiness returns 503, React displays an error with no demo fallback, and the same backend recovers after database restart. [Evidence](evidence/browser-outage.json) |
| Existing frontend desktop/mobile/browser fixtures | **8/8 PASS** on dedicated ports 25273/25274. These are separately labeled demo/HTTP-fixture regression tests, not full-system evidence. [Log](evidence/frontend-fixture-browser.log) |
| Six executed n8n workflows | **6/6 deterministic workflow executions PASS**; saved execution IDs, actual node execution status/time and compiled fixture hashes are recorded. This is execution evidence, not import-only evidence. [Evidence](evidence/n8n.json) |
| Package dependency audits | Backend, frontend and MCP: **0 findings**. MCP Zod upgraded to patched 4.6.7 with regression verification. [Backend](evidence/backend-audit.json), [frontend](evidence/frontend-audit.json), [MCP](evidence/mcp-audit.json) |
| Real AI-model E2E | **NOT VERIFIED**. No task OpenAI environment credential and no OpenAI credential in the dedicated n8n store. No paid calls were made. Fixture data is explicitly synthetic. |
| Time-based approval expiry | **OUT OF SCOPE for G3 MVP; Product Owner ratification pending.** No TTL is implemented or claimed. Permission-based revocation, explicit human revocation and expired credentials remain separate tested gates. |

The passing groups overlap and are not added into a misleading global acceptance total. Component checks do not substitute for the actual Chromium/HTTP/n8n/SQL gates.

## Demonstrated business trace

A fresh synthetic human logs into localhost:25173 and creates a project in React. Backend creation atomically assigns the configured service—there is no post-creation fixture SQL intervention. The human requests planning; the backend persists the original operation, request identity, context hash and base version. Its worker calls WF-01 → WF-02 Coordinator → WF-03 Planner/Reviewer using marked deterministic fixtures. The authenticated MCP SDK tool callback validates the strict result shape and original base, and the backend stores an immutable draft linked to the original operation.

React displays that draft and its exact SHA-256 hash. A synthetic human session submits review, explicitly confirms the displayed version/hash, and approves it. Publication creates persisted tasks. Kanban and list survive reload; the project dashboard and immutable activity history agree. SQL verifies origin_operation_id, operation context, original base, terminal status and task count. The second browser cannot read that project. Separate actual n8n WF-05 publication and same-key replay also succeed; WF-04 reads persisted counts/tasks and WF-06 reports operation state.

The trace is linked across [browser request IDs](evidence/browser.json), [database operation/audit records](evidence/runtime.json), and [n8n execution IDs](evidence/n8n.json). Synthetic UUIDs are consistently aliased in delivered JSON; original alias maps and raw execution diagnostics remain only in ignored local .g3 files. Screenshots contain synthetic UI data only: [draft](evidence/draft.png), [human approval](evidence/approved.png), [Kanban](evidence/kanban.png), [activity](evidence/activity.png), [revocation](evidence/revoked.png).

## Isolation and security

The new compose project is `uapm-g3`. PostgreSQL 17 and n8n 1.74.0 have new dedicated volumes and loopback ports 25439/25682. Host frontend/backend/MCP use 25173/23081/23082. A newly built backend container is also executed on loopback 23084 and reports ready. [Runtime evidence](evidence/runtime.json) records container/image identifiers and all migration application rows, including **003_operation_context.sql** and **004_approval_revocations.sql** in uapm_g3. uapm_test exists only in the same newly created G3 PostgreSQL container.

Human sessions consistently use localhost; containers use explicit internal service/host names. Cookies remain server-owned HttpOnly/Strict; reload uses CSRF bootstrap, and mutation keys are retained after ambiguous responses. The frontend stores only key/fingerprint pairs for pending writes, not a second domain-state database. MCP remains a controlled tool/resource adapter. n8n webhooks require a bearer stored in its dedicated encrypted credential store; the fixture compiler excludes all AI credential nodes. Credentials, raw n8n headers and environment files are excluded from Git.

Service approval attempts fail server-side; publication rechecks exact immutable hash, current authority and permanent revocation. The configured service gets project membership, not human approval rights. Publication replay retains the original key and creates no duplicate tasks. The canonical backend remains authoritative for every domain mutation and audit record.

No existing production n8n, PostgreSQL, MCP port 8100, website, mail, Messe Hub or Employee Onboarding service was modified. No production deployment, paid infrastructure, force push or main merge occurred.

## Remaining gaps

| Classification | Gap / required next step |
| --- | --- |
| **Blocker for full AI acceptance** | Securely configure an authorized provider credential in this isolated n8n instance and execute a real bounded planning request. The separate native AI profile is prepared and passes mock-provider execution; actual provider execution remains unverified. It caps output at 1,200 tokens and total model calls at three behind a locked durable budget guard. See AI_PROFILE.md for the exact secure resumption procedure. |
| **External release gate** | Product Owner must ratify retaining P1 and excluding time-based approval expiry from the G3 MVP. No TTL implementation or migration is planned for this candidate. |
| Deferred enhancement | Broader live task/plan editing, project budgets/deadlines and conversation UX remain limited by the completed component/API feature set. Unsupported live actions fail explicitly. Manual revision currently copies a snapshot and edits the first task title. |
| Deferred beyond local acceptance | Production TLS, retention, backups, container security assessment, deployment controls and capacity testing. This local test result makes no production-readiness claim. |

[Setup and repeatable commands](README.md) reproduce the local product and each evidence group. Final release acceptance remains withheld until genuine AI execution and the external owner decisions in FINAL.md are completed.
