# UAPM Automation — n8n multi-agent orchestration

Six workflows live under `automation/n8n/workflows/`:

| ID    | Workflow                             | Trigger                                   |
| ----- | ------------------------------------ | ----------------------------------------- |
| WF-01 | Chat Development Adapter             | n8n Chat Trigger                          |
| WF-02 | Multi-Agent Core                     | HTTP Webhook (service-to-service) + sub-workflow |
| WF-03 | Planning and Review                  | Sub-workflow                              |
| WF-04 | MCP Read Operations                  | Sub-workflow                              |
| WF-05 | Approved Mutation Executor           | Sub-workflow                              |
| WF-06 | Error and Operation Reporting        | Sub-workflow                              |

## Agents (defined inside WF-02 / WF-03)

- **Coordinator** (WF-02): classifies intent (`plan` / `review` / `status`
  / `change` / `clarify`), routes to the right downstream workflow,
  returns short user-facing responses. Max iterations 3–5.
- **Planner** (WF-03): produces a schema-conformant `PlanDraft`.
  Domain-agnostic. Structured output only. Max iterations 3.
- **Reviewer** (WF-03): single pass review. Returns issues + optional
  `revisedPlan`. Bounded Planner → Reviewer loop: at most one automatic
  revision in MVP.

## Deterministic execution layer

Writes NEVER come straight from an AI agent. WF-05 is the executor:

1. Validate structured mutation request.
2. If the mutation is `publish_approved_plan`, call `get_approval_status`
   first and reject if not approved.
3. Call the required MCP tool via HTTP, with timeout and bounded retry.
4. Shape the result into a structured response, including `operationId`.

High-impact field changes (priority, assigneeId, dueDate) are blocked by
the backend (`approval_required`), independent of what the agent said.

## Model and cost control

- Model: configurable, default `gpt-4.1-mini` via `UAPM_MODEL`.
- Credentials never hardcoded; use n8n credential store (`uapm-openai`).
- No autonomous infinite loops — every agent has `Max Iterations`.
- Pagination enforced on all read workflows.
- WF-04 reads only project overview + first 50 tasks for status answers.

## Import instructions

```bash
# Open n8n at http://127.0.0.1:15682 after `docker compose up`.
# Credentials → create "UAPM OpenAI (dev)" using OPENAI_API_KEY.
# Credentials → create "UAPM service header auth" using header
#   name: authorization value: Bearer <UAPM_MCP_SERVICE_TOKEN>
# Workflows → Import from file (one by one, WF-02 first):
#   automation/n8n/workflows/wf-02-multi-agent-core.json
#   automation/n8n/workflows/wf-03-planning-review.json
#   automation/n8n/workflows/wf-04-mcp-read-ops.json
#   automation/n8n/workflows/wf-05-approved-mutation-executor.json
#   automation/n8n/workflows/wf-06-error-reporting.json
#   automation/n8n/workflows/wf-01-chat-dev-adapter.json
# After import, note the workflow IDs n8n assigned to WF-02..WF-05 and
# set env vars on the n8n container:
#   UAPM_WF_MULTI_AGENT_CORE_ID
#   UAPM_WF_PLANNING_REVIEW_ID
#   UAPM_WF_READ_OPS_ID
#   UAPM_WF_MUTATION_ID
```

## Service-to-service entry point

WF-02 exposes a webhook (`POST /webhook/uapm-multi-agent-core`) protected
by header auth. This is the integration point for the UAPM backend — it
does **not** depend on an interactive Chat Trigger session.

## Correlating executions with operations

- `request.principal.correlationId` is attached to every MCP call via
  `x-correlation-id`.
- MCP responses carry `operationId`, surfaced back to the Coordinator for
  the user-facing reply ("done, operationId=…").
- WF-06 reconstructs an error report using the correlation ID and the
  first `operationId` seen in the failure.

## Known limitations

- Workflows reference `@n8n/n8n-nodes-langchain.agent` and `.lmChatOpenAi`
  which are standard in n8n ≥ 1.57. Verify with `docker exec uapm-n8n-dev
  n8n --version`. If a node is missing in the installed version, replace
  the agent block with an `HTTP Request` to the OpenAI API — behaviour is
  the same.
- No Telegram adapter in MVP (production chat / Telegram adapters are
  future interfaces).
- Approvals are issued outside n8n via the UAPM backend's human review
  UI. n8n's role is to detect approval state, not to grant it.
