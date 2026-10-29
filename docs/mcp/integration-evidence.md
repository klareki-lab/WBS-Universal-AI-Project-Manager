# Integration evidence (G3)

Reproducible real-system verification against:

- Backend from `feat/backend-core` running at `http://127.0.0.1:13081`
  (container `uapm-dev-backend-1`, commit `7faca55`).
- Canonical contract: `packages/contracts/openapi.yaml` on that branch.
- n8n image: `n8nio/n8n:1.74.0` on an isolated local container.

## Service identities used

```
# read + plans:write + operations:write — for createPlanDraft, read tests, etc.
docker exec -e SERVICE_NAME="…" -e SERVICE_PROJECT_ID="<pid>" \
  -e SERVICE_SCOPES="read,plans:write,operations:write" \
  uapm-dev-backend-1 node dist/apps/backend/src/admin.js create-service

# read + plans:write + plans:publish + operations:write — for full publish flow
docker exec -e SERVICE_NAME="…" -e SERVICE_PROJECT_ID="<pid>" \
  -e SERVICE_SCOPES="read,plans:write,plans:publish,operations:write" \
  uapm-dev-backend-1 node dist/apps/backend/src/admin.js create-service
```

Tokens are per-session, never committed.

## Test totals

| Suite                                        | Cases | Status  |
| -------------------------------------------- | ----- | ------- |
| Mock-backend end-to-end (`mutations`, `discovery`, `access`, `log-redaction`) | 13 | ✅     |
| Contract-level HTTP (fake server, exact OpenAPI shapes) | 8  | ✅     |
| Regression (permissions / versions / idempotency / callbacks) | 9  | ✅     |
| Real backend reads + draft (service bearer, no approval) | 7  | ✅     |
| **Real backend FULL publish flow** (plans:publish + human decidePlan) | 5  | ✅     |

**= 42/42 cases passing** on the current branch. 12 of those cases hit a
real running backend; 5 of those exercise the full flow including a real
human `decidePlan` approval.

## Real HTTP integration tests

```bash
# Reads + plans:write draft (no publish)
UAPM_REAL_BACKEND_URL="http://127.0.0.1:13081" \
UAPM_REAL_BACKEND_TOKEN="<service token with plans:write>" \
UAPM_REAL_PROJECT_ID="b730caea-ee23-42cf-bc22-9faca74fcfa2" \
UAPM_REAL_PLAN_ID="af272822-8d51-46e7-b5b9-de966508fb7f" \
LOG_LEVEL=fatal node --import tsx/esm --test --test-isolation=none \
  test/real-backend-integration.test.ts
# → 7/7 pass

# Full publish flow with human decidePlan
UAPM_REAL_BACKEND_URL="http://127.0.0.1:13081" \
UAPM_REAL_HUMAN_EMAIL="<admin>" UAPM_REAL_HUMAN_PASSWORD="<pw>" \
UAPM_REAL_ADMIN_CONTAINER="uapm-dev-backend-1" \
LOG_LEVEL=fatal node --import tsx/esm --test --test-isolation=none \
  test/real-publish-flow.test.ts
# → 5/5 pass
```

Observed real publish flow (`test/real-publish-flow.test.ts`):

```
▶ Real backend: full publish flow (plans:publish + real human approval)
  ✔ service creates a plan draft via plans:write
  ✔ service requests approval (submit-review + request-approval sequencing)
  ✔ human decidePlan approves the plan (cookie + CSRF, content_hash binding)
  ✔ service publishes the approved plan with plans:publish scope and content_hash
  ✔ get_approval_status reports a real decidedBy (not derived)
```

Steps the test performs against the live backend:

1. Human login via `POST /api/v1/auth/login` → extracts session cookie +
   `csrf_token`.
2. Create a project (human-only) via cookie + CSRF + idempotency.
3. Provision a service token with `read,plans:write,plans:publish,operations:write`
   scoped to that project (`admin.js create-service` CLI).
4. Service `createPlanDraft` via `plans:write`.
5. Service `requestPlanApproval` → adapter chooses `submit-review` for a
   draft plan.
6. Human `decidePlan` via cookie + CSRF with `{content_hash, decision: "approved"}`.
7. Service `publishApprovedPlan` with `plans:publish` scope + the same
   `content_hash`.
8. `getApprovalStatus` — asserted `decidedBy` is populated from the audit
   log (NOT derived from plan state).

## n8n deterministic end-to-end execution

```
docker build -t uapm-mcp:dev apps/mcp-server
docker network create uapm-g3-net
docker network connect uapm-g3-net uapm-dev-backend-1
docker run -d --name uapm-mcp-g3 --network uapm-g3-net \
  -p 127.0.0.1:13082:3002 \
  -e UAPM_BACKEND_MODE=http \
  -e UAPM_BACKEND_BASE_URL=http://uapm-dev-backend-1:3001 \
  -e UAPM_BACKEND_SERVICE_TOKEN=<service token> \
  -e UAPM_MCP_SERVICE_TOKEN=<mcp token> \
  uapm-mcp:dev
docker run -d --name uapm-n8n-g3 --network uapm-g3-net \
  -p 127.0.0.1:15682:5678 \
  -e MCP_UAPM_URL=http://uapm-mcp-g3:3002 \
  -e MCP_UAPM_SERVICE_TOKEN=<mcp token> \
  n8nio/n8n:1.74.0
docker cp automation/n8n/workflows uapm-n8n-g3:/tmp/wf
docker exec uapm-n8n-g3 n8n import:workflow --separate --input=/tmp/wf
docker exec uapm-n8n-g3 n8n execute --id=<WF-07 manual id> --rawOutput
```

Observed output of WF-07 (deterministic `n8n → MCP → backend` chain):

```json
{
  "response": "n8n -> MCP -> backend OK: 1 project(s) visible. First: Backend E2E — release workspace",
  "itemCount": 1,
  "firstProjectId": "b730caea-ee23-42cf-bc22-9faca74fcfa2"
}
```

The data was produced by a real HTTP exchange against the live backend:

```
n8n Manual Trigger
  → HTTP POST http://uapm-mcp-g3:3002/invoke/list_projects
      (Authorization: Bearer <mcp token>)
    → uapm-mcp HTTP backend adapter
      → HTTP GET http://uapm-dev-backend-1:3001/api/v1/projects?limit=5
          (Authorization: Bearer <backend service bearer>)
```

### Workflows requiring OpenAI credentials vs deterministic

| Workflow                                                   | Needs OpenAI? | Deterministically testable? |
| ---------------------------------------------------------- | ------------- | --------------------------- |
| WF-01 Chat Development Adapter                             | yes (invokes WF-02's Coordinator agent) | no (needs LLM output)  |
| WF-02 Multi-Agent Core                                     | yes (Coordinator agent)                 | no                     |
| WF-03 Planning and Review                                  | yes (Planner + Reviewer agents)         | no                     |
| WF-04 MCP Read Operations                                  | no (HTTP only)                          | yes — via sub-workflow trigger with mock input |
| WF-05 Approved Mutation Executor                           | no (HTTP + approval guard)              | yes — assuming the caller supplies `operation.name` + `arguments` |
| WF-06 Error and Operation Reporting                        | no                                      | yes                    |
| WF-07 Deterministic smoke (shipped alongside)              | no                                      | **yes — reproduced above** |

WF-04/05/06 run deterministically against a running MCP+backend pair by
piping a mock input packet into their sub-workflow trigger. End-to-end
execution of WF-01/02/03 requires an OpenAI API key stored in the n8n
`uapm-openai` credential record and a human/service account that owns a
project visible to the Coordinator.

## Remaining backend dependencies

- `decidePlan` remains x-human-only — the MCP server cannot and must not
  expose it. End-to-end publish still requires a human step in the
  frontend or a cookie-auth automation.
- A per-project service token with `plans:publish` must be provisioned
  deliberately (not by default) before `publish_approved_plan` can
  succeed.
- Any future `operationResult` / `planningRequest` tool additions depend
  on backend decisions about which identity may invoke them (currently
  `operationResult` is explicitly `serviceBearer`-only).

## No side effects

- No change to `main` or other agent branches.
- No production deployment.
- No change to Klare KI MCP (port 8100), Messe Hub, Employee Onboarding
  or production n8n.
- Test n8n container and isolated Docker network were stopped and
  removed after the end-to-end verification.
- Backend state additions during the real tests: a few extra project
  rows + draft plan versions scoped to the local demo DB. No production
  data touched.
