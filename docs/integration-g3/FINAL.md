# G3-FINAL acceptance candidate

**Verdict: CONDITIONAL PASS — specific external owner actions remain. Final release acceptance is withheld. Genuine AI E2E is NOT VERIFIED; this is not a PASS of that gate.** No confirmed remaining code failure was observed in the bounded profile's local/mock checks, but these checks cannot establish real provider compatibility or plan quality.

Baseline: verified branch commit `7beaf1ca91396e63ca6b9645a736f994c14c0379`, `feat/integration-g3`, Draft PR [#4](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/pull/4). This increment preserves the deterministic graphs and canonical backend/MCP/contracts/migrations. No main merge, force push, production deployment or paid infrastructure occurred. All identities, prompts and records in the new evidence are synthetic.

## Actual result and evidence boundaries

| Required delivery / gate | Result |
| --- | --- |
| Separate genuine AI-enabled graph | **Prepared and imported.** Three separate native workflows retain OpenAI model nodes and `uapm-openai` references; imported nodes/connections match reviewed source. [Profile evidence](evidence/ai-profile.json), [setup](AI_PROFILE.md) |
| Actual OpenAI request/output | **NOT VERIFIED.** No suitable OpenAI credential in the dedicated G3 store or task environment. No paid calls; real budget ledger has zero reservations. Expense authorization was requested but not received. There is no fabricated provider request ID. |
| Actual React → backend → AI profile, missing credential | **PASS negative case.** Fresh project and planning request through real React; original operation/context/base persisted; native Coordinator credential lookup fails; MCP failure callback marks the original operation failed after one attempt; no draft or fixture fallback. [Evidence](evidence/ai-missing-credential.json), [screenshot](evidence/ai-missing-credential.png) |
| Native three-role model profile with local mock provider | **PASS — MOCK ONLY.** Actual n8n Coordinator/Planner/Reviewer OpenAI model nodes send bounded JSON requests through the local guard; MCP stores a PostgreSQL immutable draft linked to the original operation/base. No approval or tasks created. [Evidence and exact synthetic provenance](evidence/ai-native-mock.json) |
| AI-generated immutable draft displayed in React | **NOT VERIFIED.** The mock draft is not genuine model output and is not counted. `ai/browser.mjs` is prepared to verify the actual version/hash after owner actions. |
| Human approval and publication of genuine AI output | **NOT VERIFIED.** Baseline human-role UI lifecycle and current real HTTP approval/publication evidence remain valid, but neither proves publication of a real AI plan. |
| Service/AI approval prohibition | **PASS.** Latest HTTP regression denies service approval with 403; AI graph contains no tool, approval, mutation-executor or publication route. Backend still enforces human authority. |
| Bounded safety tests | **10/10 PASS.** Strict planner/reviewer/coordinator schemas; no automatic repair; provider timeout/unavailability; credential/expense gate; persistent crash reservation; duplicate/concurrent invocation; stage order; maximum calls; malformed output; stale operation denial. These provider boundary tests use mocks/local HTTP. |
| Necessary real HTTP regression | **22/22 PASS.** Existing deterministic HTTP/MCP/n8n/PostgreSQL suite, including service approval denial, exact hashes, persisted publication/dependencies, same-key replay, stale/concurrent writes, revocation and expired credentials. [New final evidence](evidence/final-http.json) |
| Frontend changed-code regression | **29/29 PASS; build PASS.** One German help sentence now describes synthetic test inputs without claiming all execution modes use fixtures. Layout, assets and workflow remain intact. |
| Backend 49/49, MCP 22/22, other Chromium groups, audits | **Reused verified baseline.** No backend/MCP/contracts/dependency changes invalidate those results. No repeated audits or full baseline rebuilds were needed. See [baseline report](REPORT.md). |
| Static checks | New/changed scripts parse; `git diff --check` passes. No package defines a lint command; no nonexistent lint command is claimed as passing. [Recorded checks](evidence/final-checks.json) |

The passing groups overlap and must not be added into a global test total. The real React screenshot shows the missing-credential failure, not a generated-plan success. Previous baseline draft/approval/Kanban screenshots remain explicitly deterministic.

## Approval policy / acceptance requirements

The G3 MVP retains existing P1 behavior. **Time-based approval expiry is not a committed MVP requirement and is out of scope for this candidate.** No approval `expires_at`, scheduler, implicit TTL or migration was introduced. Product Owner ratification is still pending; this task's scope instruction is not recorded as completed ratification.

| Distinct case | Evidence / disposition |
| --- | --- |
| Changed human permissions revoke pending approval | Supported/tested in existing PostgreSQL and browser policy evidence; never revived by restoring permissions |
| Explicit human revocation | Supported/tested; latest HTTP suite again rejects publication after revocation |
| Expired user/session/service credentials | Authentication behavior supported/tested; latest HTTP suite again rejects expired session/service token |
| Time-based approval expiry | Out of MVP scope, subject to Product Owner ratification; not implemented or claimed |

The MCP compatibility value `expired` for a revoked approval means invalidated authority, not a timer. [P1 scope clarification](../backend/remediation/APPROVAL_POLICY.md) documents this distinction without changing behavior.

## Cost and credential assessment

Only the dedicated `uapm-g3` instance was inspected. Its original credential inventory contained the webhook credential alone; the local native-node test additionally installs an explicitly named **MOCK ONLY** protocol credential, which cannot authenticate to OpenAI. No production/unrelated secrets were accessed or copied. No real customer information is involved.

The paid profile is default locked. It reserves each call durably before provider I/O, allows at most three calls in total and one per stage, caps output at 1,200 tokens, bounds full input bytes and provider time, and never automatically retries a provider invocation or refunds an ambiguous reservation. Maximum reserved cost is USD 0.03 at the documented model rates; requested owner authorization is capped at USD 0.05. Native and node retries are disabled. The credential fallback points to a denied local route, and only the reviewed stage-specific URL reaches the guard. See [limits, official documentation and exact procedure](AI_PROFILE.md).

A single owner command, `node scripts/integration-g3/ai/configure-credential.mjs`, accepts a sandbox-only key at a hidden prompt and stores it in the dedicated encrypted n8n store, without making any provider call. Real credential validity and current model/account availability remain unverified. Credential storage does not authorize expense or human plan approval.

## Runtime and investigation record

Existing G3 PostgreSQL and n8n volumes were preserved. Only the G3 backend and G3 n8n were restarted for profile verification. The default backend has been restored to the deterministic endpoint. The AI profile is available separately; mock workflow clones are disabled. The local paid budget guard is locked and its real ledger remains empty. Mock tests use their own ledger/port and cannot replenish real budget.

Early investigation attempts are retained in n8n summary evidence: an incorrect nested response-code shape and expression delimiter ambiguity were fixed before final missing-credential verification; a mock attempt exposed n8n's hidden Base URL option under node version 1.1. The corrected version-1 native profile completed mock executions **81, 82, 83**. Final missing-credential executions **84, 85** show the expected failure callback. An n8n workflow status of success on the error-handling subworkflow means the failure was reported successfully, not that model planning succeeded; PostgreSQL operation status is authoritative.

No genuine AI request, human approval of an AI-generated plan or task publication derived from genuine AI output is claimed. The prepared positive real-provider browser runner is **NOT VERIFIED** until it actually executes after owner actions. Historical/fixed investigation failures do not replace the final regression results.

## Remaining blockers and resumption

1. **Credential:** owner supplies one securely authorized sandbox-only OpenAI project key through the hidden-prompt helper above. No key should be sent in chat.
2. **Expense:** Product Owner explicitly authorizes the bounded paid run (requested maximum USD 0.05, three calls). No answer/default selection has been treated as authorization.
3. **Scope ratification:** Product Owner ratifies retaining P1 and excluding time-based approval expiry from the G3 MVP before final release acceptance.
4. **Outstanding execution:** after those external actions, run the actual React AI scenario, collect provider request IDs/usage, immutable plan provenance, human-role approval/publication and real-AI screenshots, then reassess the final verdict. Real account/model availability or output failures may reveal further blockers; mocks cannot rule them out.

No unconditional PASS is granted. The candidate remains a Draft PR and is not deployed.
