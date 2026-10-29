# Backend audit remediation handover — v1.1.0 RC

**Backend remediation: PASS. Overall release-candidate status: CONDITIONAL PASS.** All six confirmed findings F1–F6 are resolved in the reproduced local scope. No confirmed Critical or High finding remains open. P1 is resolved by an explicit conservative policy and tests, not reclassified as an original exploit. Actual frontend/MCP/live n8n integration, external independent-review sign-off and product review of the new policy remain separate acceptance conditions.

**Verified code commit:** `c7107d6d7644e9926b128a0df078b6a03566ff3e` on `feat/backend-core`. Audit target: `7faca555776d134c3483c5667bfb567487932fe4`. The subsequent commit adds documentation/evidence and a default-browser verification artifact only; `apps/backend`, `packages/contracts` and `infra/backend` trees must match the verified hashes in [verification.json](verification.json). The PR head is the delivered candidate; main is not merged or modified.

## Reproducible verification

| Verification group | Result |
|---|---|
| Complete automated suite | **46/46 PASS**, including all previous 29 tests; 39 real HTTP/PostgreSQL integration cases plus contract, CLI, adapter and DB-error tests |
| Original independent suite | **35/35 PASS**, original scenario assertions retained; commit recorded as c7107d6; **214 response-schema checks, 0 violations** |
| Real connection/outage recovery | **5/5 PASS**: checked-out asynchronous termination, idle termination, terminated active publication, DB stop with health/readiness/503, and same-PID DB restart recovery |
| Chromium site/cookie scenarios | **4/4 PASS**, including reload/bootstrap/write, independent storage/project isolation and the intentionally blocked mixed-host negative case |
| Actual documented default setup | **PASS** — Chromium localhost:5173 → running Docker localhost:13081, login 200, reload session/CSRF 200, create 201, reload/read 200 and SQL row present |
| Real worker process termination | **1/1 PASS** — SIGKILL/restart, same durable operation/idempotency ID, attempts=2, exactly one draft, zero approvals |
| Exact old-schema upgrade | **2/2 PASS** — old migrations from Git, history preserved, replay context backfilled, unverifiable legacy work failed closed, revoked old replay rejected over HTTP |
| Original callback differential probes | **2/2 agree** — neither/both payloads fail JSON Schema and return runtime 400; valid/invalid union corpus is additionally covered by the main suite |
| Docker smoke / SQL state | **PASS** — 12 tasks, 3 phases, 11 dependencies, 1 approval, 1 publish operation despite repeated publish; independent project has 0 tasks |
| TypeScript/build/format/contracts | **PASS**; generation leaves code/contracts/infra unchanged |
| npm audit | **0 vulnerabilities** |

The 46 main cases plus 35 independent and 13 additional recovery/browser/worker/upgrade cases yield **94 passing acceptance cases**, with the two original callback probes and container smoke reported separately. This does not turn a bounded local assessment into a production capacity or universal security guarantee.

The original failures were reproduced **before runtime fixes**: original independent suite 30 PASS/5 FAIL, built API exit 1 on PostgreSQL stop, documented mixed-host browser login 200 then me 401. Baseline evidence is preserved under [baseline](baseline). The supplied external report and evidence archive hashes still match [audit-inputs.json](audit-inputs.json); neither was modified or deleted.

Two setup/control attempts are deliberately retained and excluded from final totals: `current/tests-interleaved.*` overlapped a normal suite with the same fixture cluster's intentional outage; `current/tests.json` was rerun sequentially and passed 46/46. `current/upgrade-initial.json` used an uppercase random direct-fixture email while login correctly lowercases emails; the corrected fresh fixture passed. These are disclosed harness issues, not hidden backend failures.

## Resolved behavior

- **F1:** Both idle pool and checked-out-client error events are handled. Broken clients are destroyed, rollback failure does not mask the original transaction error, runtime outages return bounded sanitized 503, and the same API process reconnects after restart. No mutation is automatically retried after an ambiguous commit; exact-key retries recover the atomically stored result. Worker polling backs off; startup restart budget is three.
- **F2:** Current identity/session/token, scopes and write membership are rechecked before all mutation replays, including creation records whose resource is absent from the URL. Upgrade backfills affected project IDs; membership/user locks serialize authorization changes with writes/replay.
- **F3:** Operation UUID, original request ID, persisted input/creator/project/conversation hash, original base and current authority bind both result paths. Stale work cannot relabel its base. Failed results leave no draft, success event or successful idempotency record. Accepted plans retain origin_operation_id. Legacy pending operations lacking verifiable context fail closed.
- **F4:** API/browser hostname defaults consistently use localhost; loopback bindings and Strict/HttpOnly/Origin/CSRF protections remain. A human CSRF bootstrap endpoint supports reload without re-login or exposing the session cookie.
- **F5:** Callback `{result: PlanCreate}` **or** `{error: nonempty string}` is a structural strict union in runtime, OpenAPI, JSON Schema, generated TS, examples and documentation. Unknown/both/neither payloads are invalid. Remaining relational business rules are explicitly documented runtime 400 conditions.
- **F6:** Stored text rejects NUL and invalid lone surrogates before persistence; legitimate Unicode and multiline text round-trip.
- **P1:** Disable/removal/downgrade permanently revoke unconsumed approvals via immutable append-only records; restoration does not revive them. Current eligible owner/original approver can explicitly revoke. Consumed publications remain historical. Tests use actual lock barriers for both publication-before-disable and disable-before-publication ordering. See [APPROVAL_POLICY.md](APPROVAL_POLICY.md).

## Integration and changed files

OpenAPI is **v1.1.0**, **28 paths / 33 operations / 43 schemas**. See [integration.md](../integration.md), [contract changelog](../CONTRACT_CHANGELOG.md), [callback fixtures](../../../packages/contracts/fixtures), and [Astra gap classification](FRONTEND_GAPS.md). The PR #1 coordination notice describes the change for Claude Code and Astra; their branches/code are not edited here.

New migrations: 003 operation/replay context and plan origin; 004 approval revocations. Source changes concentrate in DB lifecycle, authentication/replay, shared operation provenance, publication authorization and schema validation. Tests and reproducible audit runners are under `apps/backend`; generated contracts/fixtures under `packages/contracts`; bounded restart configuration under `infra/backend`; evidence/policy/handover under `docs/backend`. Exact changed paths are in [changed-files.txt](changed-files.txt).

Docker image verified: `sha256:b394cc624de3d16bb22def88262abc950312b148c1c51778817f1c5dcead4d81`. The built app.js hash matches the image. Related development stack remains isolated on loopback 13081/15439. Outage tests touch only the newly labeled remediation fixture on 26439; the original audit container and production/unrelated services are not changed.

Remaining limits: no claimed live Astra UI/MCP/n8n workflow execution; explicit P1 policy awaits product ratification; broader direct-task/metadata/chat features are classified/deferred rather than fabricated. Production runtime/migrator separation, TLS, backups, centralized operational controls and retention remain prerequisites outside this local RC. No release, production deployment or main merge occurred.
