# G4 AI execution modes

The dedicated G3 guard supports `acceptance` (default) and `development`, selected once at startup by `G3_AI_BUDGET_MODE`. Both use the separate native AI n8n profile, not the deterministic workflows. Development is opt-in and locked until the owner explicitly authorizes its use and supplies local preferences. This change does not itself authorize or make paid calls.

- Acceptance uses the existing `.g3/ai-budget.sqlite` and the existing explicit acceptance authorization receipt. Its lifetime three-call/USD 0.03 reservation limits are unchanged; the historical records are never cleared. Startup fails if this ledger is missing rather than silently recreating it.
- Development uses `.g3/ai-development-budget.sqlite`, with no global three-call lifetime cap. Both ledgers are checked for cross-mode replay of the same operation; switching modes does not free its stage reservations. Preserve both files and their SQLite WAL files. Run only one guard on the fixed port; do not copy, delete, or replace either ledger.
- Both modes require a live planning operation created by an enabled human owner/editor with current membership, original base version and unchanged context hash. Each operation permits one Coordinator, Planner and Reviewer call in order; each reservation commits before I/O. The model, 1,200 output tokens, input size, provider timeout and zero model/provider retries remain bounded. At most two provider requests can be in flight in one guard; excess requests fail without provider I/O. No approval or publication authority is granted to AI.

## Owner setup in the isolated G3 environment

1. Record the Product Owner's **explicit authorization for development spending**, and decide an informational cumulative warning threshold in USD. The previous G3 acceptance authorization is limited to that run and is not development authorization. Do not put any credential in the receipt.
2. In this worktree, create the ignored file `.g3/ai-development-authorization.json` with permissions `0600` and the following structure, replacing the reference and threshold with the owner's actual decision:

   ```json
   {"mode":"development","authorized":true,"warningUsd":1.00,"ownerDecision":"reference to explicit development spending authorization"}
   ```

   `warningUsd` must be a positive number. The example is illustrative, not an authorization or a recommended spend. Revoking authorization requires setting `authorized` to false or removing this receipt; it is checked on each request. It does not erase reservations.
3. When no G3 operations are running, build the backend and update the **dedicated G3** n8n AI workflows using `node scripts/integration-g3/ai/compile.mjs` and `node scripts/integration-g3/ai/import.mjs`. The import script restarts G3 n8n; it does not touch deterministic graph definitions or volumes. Restart only the dedicated G3 backend using its AI execution profile and the dedicated guard using `G3_AI_BUDGET_MODE=development node scripts/integration-g3/ai/budget.mjs`. Follow [AI_PROFILE.md](AI_PROFILE.md) for the existing isolated service and credential setup. Never run two guards or restart while operations are in flight.
4. Run `node scripts/integration-g3/ai/usage.mjs` to view each ledger's reservations, successful calls, known input/output tokens, estimated cost and development threshold warning. A reservation can represent a timed-out or ambiguous attempt; `unknownUsage` identifies records for which cost cannot be estimated. The report uses documented GPT-4.1 mini rates of $0.40/M input and $1.60/M output tokens and is an estimate, not provider billing. Review current pricing and provider billing separately. The warning is **informational, not a hard spending cap**, is displayed when the report is run, and cannot catch usage unavailable after a failed request. Development has no aggregate cost cap.

To return to acceptance, stop the dedicated guard after operations finish and restart it with `G3_AI_BUDGET_MODE=acceptance` (or unset the variable). The existing exhausted acceptance ledger stays exhausted. No mode switch authorizes additional acceptance calls.

## Failure reporting and verification

An accepted request is queued, not a completed plan. The workspace shows the operation status and a recovery message on failure. The backend only stores an allowlist of safe failure codes; arbitrary provider messages are discarded. n8n's native chain may reduce provider errors to a generic message, so a specific guard code is surfaced only when present in the safe failure output; otherwise the user sees a general planning failure and recovery guidance. The parent workflow no longer throws merely because the child already reported a failure.

`node --test scripts/integration-g3/ai/profile.test.mjs` uses in-process mock provider responses and temporary ledgers, including two complete development operations and cross-mode replay. It makes no OpenAI calls. Backend and UI targeted tests exercise sanitized failure handling. The revised n8n workflows and development mode have not been activated or verified end-to-end against the running services; activation requires the owner setup above. The earlier G3 real-AI evidence remains historical and does not verify G4.
