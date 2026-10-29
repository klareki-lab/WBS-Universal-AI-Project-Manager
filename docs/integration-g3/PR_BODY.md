The integrated Project Studio now has a separate bounded native AI execution profile alongside the preserved six deterministic workflows. It retains the OpenAI model/credential nodes, uses one Coordinator/Planner/Reviewer pass each, validates outputs strictly and preserves original operation/base provenance. A local durable guard caps the acceptance run at three calls, 1,200 output tokens each, with zero automatic provider retries and a default-locked expense gate.

**Verdict: CONDITIONAL PASS; final release acceptance withheld. Genuine OpenAI E2E is NOT VERIFIED.** The sandbox `uapm-openai` credential is now securely configured and confirmed by metadata-only check. Explicit owner budget authorization and P1 ratification were not found in local G3 records or PR discussion/reviews, so no paid calls were made and the durable ledger remains at zero. The Product Owner must also ratify retaining P1 and excluding time-based approval expiry from the G3 MVP. No TTL schema, logic or migration was introduced.

New validation:

- Safety/profile tests 10/10; actual React missing-credential path 3/3 (one failed durable operation, no draft or fixture fallback).
- Actual native n8n Coordinator/Planner/Reviewer → budget guard → MCP → immutable PostgreSQL draft with a **mock provider only**, clearly marked and never counted as real AI output.
- Real HTTP/MCP/n8n/PostgreSQL regression 22/22; frontend tests 29/29 and build pass. Backend 49/49, MCP 22/22 and remaining browser/audit evidence are reused from verified commit `7beaf1ca91396e63ca6b9645a736f994c14c0379` because canonical backend/MCP/contracts/dependencies are unchanged.
- Continuation credential preflight confirms all three AI workflow graphs match committed source and all six deterministic workflows remain active; the stopped dedicated MCP process was restarted in HTTP backend mode.
- Real React screenshot and redacted n8n/provenance evidence are attached under `docs/integration-g3/evidence`; zero actual provider reservations.

See [final acceptance report](docs/integration-g3/FINAL.md), [AI setup and single secure credential-supply action](docs/integration-g3/AI_PROFILE.md), [baseline report](docs/integration-g3/REPORT.md) and `verification.json`. Once the Product Owner explicitly authorizes the bounded expense and ratifies the P1 scope, the prepared real-provider browser runner must complete and capture actual provider IDs, immutable version/hash, human approval and persisted publication before any PASS verdict.

No main merge, production deployment, force push, rewritten agent branch, copied production secret or replaced G3 volume. This remains a Draft PR.
