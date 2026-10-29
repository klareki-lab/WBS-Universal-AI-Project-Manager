# Audit remediation — Klare KI / KI Project Studio backend v1.1.0 RC

Audit target: `7faca555776d134c3483c5667bfb567487932fe4`. Worktree/branch remain `/Users/admin/Projects/uapm-codex`, `feat/backend-core`. Original REPORT.md and the supplied evidence archive were read in full and hash-verified against each other. They were not modified, extracted over, deleted, or used as output destinations. Input hashes are in `audit-inputs.json`.

This report supersedes the historical v1.0 handover. Final status, exact verified commit/tree hashes and totals are in `verification.json` and `HANDOVER.md` in this directory. These artifacts distinguish code verification from later documentation-only commits.

## Confirmed findings

| Finding | Fix and reproducible proof |
|---|---|
| F1 High / database connection-loss crash | Pool **and checked-out client** error listeners; broken-client destruction; rollback failure preserves the primary error; bounded connection acquisition; sanitized 503; on-demand reconnection without mutation retries. Worker infrastructure backoff and bounded Compose startup restarts documented. `current/recovery.json` exercises real idle/checked-out/active pg_terminate_backend, PostgreSQL stop/restart, same API PID recovery and exactly-one same-key retry. |
| F2 Low / revoked creation replay | Idempotency records bind resource_project_id, including upgrade backfill. Current user/session/token, scopes and write membership are checked again before replay, with authorization row locks through commit. New regression cases cover removed membership, downgrade, scope loss and concurrent permission changes. Upgrade test also covers historical creation records. |
| F3 Medium / stale AI provenance | Immutable original operation/request/input/project/creator/conversation hash; plan origin_operation_id; common validation on callback and worker paths, before delivery and application. Returned base must equal the requested base and current project version; original authority must still exist. Stale results fail without draft/success/idempotency residue. Worker marks permanent conflicts failed. Legacy unverified pending jobs fail closed at upgrade. |
| F4 Medium / browser hostname compatibility | Canonical API URL is localhost, matching the localhost frontend Origin. Strict/HttpOnly/Secure configuration, exact Origin and CSRF checks remain. Chromium proves login, session/reload bootstrap, mutation and isolation; explicit mismatched-site negative test still fails authentication as intended. |
| F5 Medium / callback contract | Structural strict result/error union in runtime, OpenAPI, standalone JSON Schema and generated TS; neither/both/empty/extra fields fail. Independent Ajv-versus-HTTP corpus, existing independent assertion and original differential probes agree. Valid result/error fixtures and Claude Code mapping are versioned. Task paired-reference/date-order/graph/project constraints are explicitly semantic runtime 400 rules. |
| F6 Low / NUL validation | Representable persistable-Unicode constraint across text fields, plus stable database data-error fallback. NUL and lone surrogates fail 400 before writes; Unicode/multiline content round-trips. Tests assert no project/plan/event/idempotency success residue. |
| P1 policy probe | Explicit conservative RC decision, not retroactively called an original exploit. Immutable revocations permanently invalidate unconsumed approvals on disable/removal/downgrade or explicit human revocation. Consumed history remains valid. Eligibility/revocation and concurrent-disable checks tested. See APPROVAL_POLICY.md. |

All eight Astra BACKEND_GAPS.md entries at branch SHA 091e37d6df5214c1ec91ccc50edb45d3002f563c are classified in FRONTEND_GAPS.md. Necessary CSRF/bootstrap and approval-history fixes are implemented; native unapproved tasks, additional metadata/chat and frontend lockfile work are explicitly deferred or assigned to the frontend owner rather than implemented outside architecture/ownership.

## Before/after evidence boundaries

Baseline rerun against the unmodified executable audit target reproduced **30 PASS / 5 FAIL** in the original 35-scenario suite, the database-stop process exit **1**, and the browser default `login 200 → me 401`. These are in `baseline/`. The browser isolation subcase is SKIP when its prerequisite default login fails; it is not a second independent backend defect. The fixed-host negative case remains PASS.

The copied original runners change fixture addresses/paths, add fixture-boundary guards and formatting, retaining the original scenario assertions. New recovery/browser/upgrade runners add explicit acceptance checks. `current/upgrade-initial.json` retains a setup failure: its randomly generated fixture email contained uppercase characters while login correctly normalizes email. The corrected fixture lowercases the email and uses a new database; the failure is not attributed to backend code and is excluded from final acceptance totals. `current/tests-interleaved.*` also preserves an invalid harness run that overlapped the normal suite with a deliberate stop of their shared fixture cluster. It is excluded; the authoritative `current/tests.json` was rerun sequentially after recovery and has 46/46 PASS.

No original audit database/container was started or changed. Only the new labeled `uapm-remediation-20261028-db` on loopback 26439 is interrupted by recovery tests. Its synthetic baseline/current/upgrade databases are separate; none of the original audit evidence is a test output. The related `uapm-dev` backend image is rebuilt for container smoke testing; unrelated/production services are not changed.

## Reproduce independently

Use Node 24, Docker, and a fresh local fixture. If creating the fixture yourself, use only this isolated named container, check that port 26439 is free, and verify its label before any stop/restart:

```sh
docker run --detach --name uapm-remediation-20261028-db \
  --label uapm.remediation=20261028 --publish 127.0.0.1:26439:5432 \
  --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=uapm_test \
  --env POSTGRES_USER=uapm_audit postgres:17-alpine
docker exec uapm-remediation-20261028-db pg_isready -U uapm_audit
```

Trust authentication is **only** for this disposable loopback synthetic fixture. Development/product Compose still requires a generated password. Never use these runners with an existing or production database. They do not drop databases. Repeated independent/upgrade runs require fresh database names; preserve prior evidence instead of overwriting originals.

```sh
# Use a new suffix if this database already exists.
docker exec uapm-remediation-20261028-db createdb -U uapm_audit uapm_remediation_verify2
mkdir -p docs/backend/remediation/verify2
cd apps/backend
npm ci --ignore-scripts
npm run typecheck
npm run contracts
npm run build
npm run format:check
npm audit
export TEST_DATABASE_URL=postgresql://uapm_audit@127.0.0.1:26439/uapm_test
export AUDIT_DATABASE_URL=postgresql://uapm_audit@127.0.0.1:26439/uapm_remediation_verify2
export AUDIT_EVIDENCE_DIR=../../docs/backend/remediation/verify2
npm test -- --reporter=default --reporter=json --outputFile.json=$AUDIT_EVIDENCE_DIR/tests.json
node node_modules/tsx/dist/cli.mjs audit/independent.ts
node audit/recovery.mjs
node audit/worker-restart.mjs
```

Inspect record statuses, not just process exit: the original independent runner deliberately exits zero after collecting failures. `independent-results.json` must have 35 pass/0 fail and 0 response-schema violations. Recovery must have 5 PASS and the same API PID before/after the outage. Worker restart must have one draft, zero approvals and the same operation ID for both deliveries.

For actual browser tests, use a local Chromium executable via CHROMIUM_EXECUTABLE or install a project-local browser (ignored and outside the Docker image):

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node audit/browser.mjs
```

The browser runner opens a synthetic frontend site on localhost:26482 and the actual built API on 26481. Four cases must PASS. This tests the documented site arrangement and genuine cookies, not the unavailable Astra UI. Additionally `current/default-browser.json` verifies the actual default Docker API at localhost:13081 from a synthetic frontend on localhost:5173, including reload/CSRF bootstrap, mutation and SQL persistence. With the default Compose stack running and port 5173 free, reproduce from apps/backend using `node --env-file=.env ../../docs/backend/remediation/default-browser.mjs` (set CHROMIUM_EXECUTABLE or project-local PLAYWRIGHT_BROWSERS_PATH as above). That verification artifact checks the uapm-dev container label and default loopback DB before seeding its synthetic identity.

For migration upgrade, create a fresh database and set UPGRADE_DATABASE_URL to a local `/uapm_upgrade_rcN` database on 26439; run `node audit/upgrade.mjs`. It applies the **exact old migrations from Git 7faca55**, seeds historical data, applies new migrations twice and verifies immutable history, backfill, fail-closed legacy jobs, and real HTTP replay authorization. Never reset another database to run this fixture.

The original callback differential runner can be run while a built API is separately listening on 26481 against AUDIT_DATABASE_URL. Both recorded invalid payloads must now have `schema_accepts:false` and HTTP 400. Main tests additionally cover both valid union branches and invalid extras/empty errors using a separate Ajv compiler.

## Coordination and remaining release conditions

For Claude Code: rebuild generated client types against v1.1.0; callback body is still exactly `{result: PlanCreate}` OR `{error: nonempty string}`. Do not echo delivery metadata into the strict callback body. Delivery adds original request_id/context_hash for correlation; stale or relabeled bases now produce 409 and require a new planning request. Backend enforces original authority and context; MCP must never rewrite the base or invent approval. The PR #1 update carries this interface notice; no MCP implementation is changed here.

For Astra: use consistent site hostnames, call auth/csrf after reload, display revocation history, persist exact pending commands/keys before dispatch and respect returned PlanVersion semantics. Its alternate all-127.0.0.1/15173 setup can remain if actual browser URLs and ALLOWED_ORIGIN agree. Actual frontend/MCP/live n8n integration and external independent reviewer sign-off remain unverified. The RC has no reproduced open critical/high findings; this bounded verification is not a universal security guarantee.

Production prerequisites remain: separate runtime/migrator roles, TLS ingress, backups/restore, shared rate limits/monitoring and operational retention. No production deployment, main merge or release is performed. P1's new conservative business policy is explicit for product-owner ratification.
