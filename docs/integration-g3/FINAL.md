# G3-FINAL acceptance report

**Verdict: PASS for the agreed isolated G3 MVP acceptance.** Real OpenAI output passed through React → backend → n8n Coordinator/Planner/Reviewer → MCP → PostgreSQL → synthetic human-role approval → persisted Kanban. The owner ratified P1 and authorized the bounded run in [PR comment #6490217776](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/pull/4#issuecomment-6490217776). This is local acceptance, not production deployment or product-owner approval of the generated plan itself.

The real run used three `gpt-4.1-mini` requests. Provider request IDs, token usage, original operation ID, request ID, context hash, immutable plan version/hash, human-role decision, publication operation, persisted tasks and activity events are recorded in [redacted real-run evidence](evidence/ai-real.json) and [browser evidence](evidence/ai-browser.json). n8n executions **93, 94 and 95** completed successfully. Estimated model cost at the documented rates is **USD 0.0013224**; the durable ledger reserves USD 0.03, within the owner's USD 0.05 ceiling. Three calls consumed the entire authorized call budget. No ledger reset or provider retry occurred.

React screenshots: [generated draft](evidence/ai-draft.png), [human-role approval](evidence/ai-approved.png), [persisted Kanban](evidence/ai-kanban.png), [dashboard](evidence/ai-dashboard.png), and [activity](evidence/ai-activity.png). Direct service approval was rejected with 403; the approval recorded in PostgreSQL is for a human identity and binds the exact hash. Published tasks remain present after refresh.

The initial browser attempt found an unrelated service on port 25173 and made zero model calls. G3 ran separately on port 25174. The successful AI run's initial dashboard assertion expected the first task title, but the dashboard displays urgent tasks only. A targeted follow-up verified the dashboard's three open tasks and publication event, plus activity history, without additional model calls. The initial assertion failure is retained in browser evidence. No unrelated service was changed.

MCP commit `32b80d5a6646a84b79ec25b9a2cf42710b611eff` was reconciled in merge `8d784c6`: the new `/invoke` facade uses the same SDK catalog and schema validation as `/mcp/call-tool`. Original operation base, authoritative approval/revocation checks and deterministic workflow paths were preserved. MCP build and **34 tests passed**; optional real-backend suites were skipped and are not counted. Previously verified deterministic HTTP 22/22, backend 49/49 and frontend 29/29 are reused; they were not rerun unnecessarily.

P1 remains unchanged: loss of authority and explicit human revocation invalidate unconsumed approvals, and expired credentials are rejected. Time-based approval expiry is excluded from the MVP by the owner decision; no TTL or migration was added. Synthetic data only was used. Credential metadata was checked without displaying its value. Existing G3 volumes were preserved. No main merge or production change occurred.

Remaining limitations: this is an isolated acceptance run using a synthetic human-role browser session; production security, privacy, deployment and operations reviews remain outside this acceptance. Actual provider-account billing may differ from the usage-based estimate. The authorized three-call budget is exhausted.

## G4 development follow-up

G4 adds opt-in development accounting and preserves the historical acceptance budget and its evidence. See [development mode](DEVELOPMENT_MODE.md) for owner setup, mock verification and limitations. No G4 paid call or live rollout has been performed; the historical G3 acceptance verdict above does not verify the new mode.
