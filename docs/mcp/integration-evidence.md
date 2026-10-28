# Integration evidence (2026-10-28)

Reproducible real-system verification against:

- Backend from `feat/backend-core` running at `http://127.0.0.1:13081`
  (container `uapm-dev-backend-1`, Codex worktree, commit `7faca55`).
- Canonical contract: `packages/contracts/openapi.yaml` on that branch.
- n8n image: `n8nio/n8n:1.74.0` on an isolated local container.

## Service identity used for the test run

```
docker exec \
  -e SERVICE_NAME="mcp-integration-test-<timestamp>" \
  -e SERVICE_PROJECT_ID="b730caea-ee23-42cf-bc22-9faca74fcfa2" \
  -e SERVICE_SCOPES="read,plans:write,operations:write" \
  uapm-dev-backend-1 \
  node dist/apps/backend/src/admin.js create-service
# → {"id":"abd5db01-...","token":"<redacted>","expires_in_days":90}
```

Token stored only in-session for the duration of the test. Not committed. The
service is scoped to the demo project seeded by the backend smoke test
(`b730caea-ee23-42cf-bc22-9faca74fcfa2`) and has no publish or approval scope.

## Real HTTP integration tests (uapm-mcp → real backend)

Run from `apps/mcp-server/`:

```bash
UAPM_REAL_BACKEND_URL="http://127.0.0.1:13081" \
UAPM_REAL_BACKEND_TOKEN="<service-token>" \
UAPM_REAL_PROJECT_ID="b730caea-ee23-42cf-bc22-9faca74fcfa2" \
UAPM_REAL_PLAN_ID="af272822-8d51-46e7-b5b9-de966508fb7f" \
LOG_LEVEL=fatal node --import tsx/esm --test --test-isolation=none \
  test/real-backend-integration.test.ts
```

Observed result:

```
▶ Real backend integration (feat/backend-core, OpenAPI canon)
  ✔ listProjects returns the service's project
  ✔ getProject returns the service's project detail
  ✔ getProjectProgress returns dashboard mapped to internal shape
  ✔ getPlanScoped returns an existing plan version with content hash
  ✔ createProject is refused by the human-only policy guard without a network call
  ✔ createPlanDraft creates a new draft plan via POST /plans (plans:write service scope)
  ✔ replayed idempotency key does not create a duplicate draft
✔ Real backend integration (feat/backend-core, OpenAPI canon)
ℹ tests 7  pass 7  fail 0  duration_ms 733
```

Each case hits a real endpoint on the live backend container:

| Case                                       | HTTP exchange(s)                                                                      | Verification                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| listProjects                               | `GET /api/v1/projects?limit=50` + `Authorization: Bearer <token>`                     | Service's project is present                              |
| getProject                                 | `GET /api/v1/projects/{projectId}`                                                    | Backend echoes same id                                    |
| getProjectProgress                         | `GET /api/v1/projects/{projectId}/dashboard`                                          | Mapped to internal shape with sane completionRatio        |
| getPlanScoped                              | `GET /api/v1/projects/{projectId}/plans/{planId}`                                     | 64-char content hash present                              |
| createProject human-only guard             | **no network call** — adapter throws `human_only` locally                             | 2026 contract rule `x-human-only: true` enforced          |
| createPlanDraft (plans:write)              | `GET /api/v1/projects/{projectId}` → `POST /api/v1/projects/{projectId}/plans`        | Plan draft created with 64-char hash                      |
| Idempotent replay                          | Same `Idempotency-Key` reused on `POST /plans`                                        | Backend returns same plan version id (no duplicate)       |

## Contract-level integration tests (fake HTTP server, no live backend needed)

8 cases in `test/http-client-contract.test.ts` exercise the exact HTTP shapes
(headers, paths, request/response bodies, status→code mapping, idempotency
header, priority translation `critical`↔`urgent`, dashboard shape, publish
`content_hash` payload, human-only guards). All pass.

## Mock-backend tests (reference tests, no live services)

13 cases in `test/discovery.test.ts`, `test/access.test.ts`,
`test/mutations.test.ts`, `test/log-redaction.test.ts`. All pass.

## Combined

Running the full suite with the live backend reachable:

```bash
LOG_LEVEL=fatal npm test
# plus
UAPM_REAL_BACKEND_URL=... UAPM_REAL_BACKEND_TOKEN=... UAPM_REAL_PROJECT_ID=... \
  node --import tsx/esm --test --test-isolation=none test/real-backend-integration.test.ts
```

Totals:

- 13 mock-backend tests ✓
- 8 contract-level HTTP tests ✓
- 7 real-backend integration tests ✓

**= 28/28 tests passing against the canonical OpenAPI, including 7 that
touch a live backend container.**

## n8n workflow verification

```bash
docker run -d --name uapm-n8n-wf-test \
  -p 127.0.0.1:15682:5678 \
  -e N8N_HOST=127.0.0.1 -e N8N_PROTOCOL=http -e N8N_SECURE_COOKIE=false \
  -e N8N_ENCRYPTION_KEY='test-key-32chars-exactly-00000000' \
  n8nio/n8n:1.74.0
docker cp automation/n8n/workflows uapm-n8n-wf-test:/tmp/workflows
docker exec uapm-n8n-wf-test n8n import:workflow --separate --input=/tmp/workflows
```

Observed:

```
Importing 6 workflows...
Successfully imported 6 workflows.
```

Workflow IDs assigned by n8n at import time:

| MCP WF-ID | n8n ID                 | Workflow name                                 |
| --------- | ---------------------- | --------------------------------------------- |
| WF-01     | `DUdnvdCXboVN0naX`     | UAPM WF-01 — Chat Development Adapter         |
| WF-02     | `cUqpnQtlPPksM394`     | UAPM WF-02 — Multi-Agent Core                 |
| WF-03     | `NduWCgPaL7CLpJAM`     | UAPM WF-03 — Planning and Review              |
| WF-04     | `EGY0DjHAtvIbaSIw`     | UAPM WF-04 — MCP Read Operations              |
| WF-05     | `ykDmnOs0q6tBzQjk`     | UAPM WF-05 — Approved Mutation Executor       |
| WF-06     | `0oq7xilf2z9HqF5W`     | UAPM WF-06 — Error and Operation Reporting    |

**Note:** these IDs are from the test container and will differ on each
installation — they are included only as evidence that import succeeded.
Full workflow execution requires OpenAI credentials in the n8n credential
store and the MCP server reachable at `MCP_UAPM_URL`.

## E2E scenarios blocked by other work

- **End-to-end planning→publish via real backend:** Requires `plans:publish`
  scope on the service identity AND a human-approved plan version. The
  current test service has only `read,plans:write,operations:write`.
  Approvals (`POST /plans/{planId}/approvals`) are `x-human-only: true` and
  must be performed via the frontend. Blocker: Astra frontend / human.
- **Live n8n → MCP → backend chain:** Requires:
  - OpenAI API key in n8n credentials.
  - `MCP_UAPM_URL` and `MCP_UAPM_SERVICE_TOKEN` set on the n8n container.
  - The uapm-mcp container reachable on the n8n container's Docker network.
  This is wired in `infra/mcp/docker-compose.yml`. Executing the chain is
  deferred to deployment and does not block the MCP implementation itself.
- **`get_task` / `get_plan_version` / `request_plan_approval` /
  `publish_approved_plan` / `get_approval_status` tool wiring:** The real
  contract requires `projectId + taskId` or `projectId + planId` in the
  path, but these MCP tools in v1 accept only a single id. The HTTP adapter
  exposes the scoped variants (`getTaskScoped`, `getPlanScoped`,
  `getApprovalScoped`, `requestPlanApprovalScoped`,
  `publishApprovedPlanScoped`) and throws a clear `validation_error` with
  guidance when called via the legacy single-id tool shape. Follow-up: the
  tool catalog needs to accept composite IDs (two inputs) or the tools must
  be refactored to use the project-scoped paths natively.

## No side effects

- No change to Klare KI MCP (port 8100), Messe Hub or Employee Onboarding.
- Test n8n container stopped and removed after the import verification.
- Backend state: one additional draft plan version was created on the demo
  project `b730caea-ee23-42cf-bc22-9faca74fcfa2` as part of the real
  integration test. No publish, approval, task status change or project
  creation occurred.
