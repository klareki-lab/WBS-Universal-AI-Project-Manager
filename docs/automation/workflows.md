# Workflow architecture

## Data shape between workflows

The internal request packet carried end-to-end:

```json
{
  "request": {
    "text": "the user utterance or structured goal",
    "sessionId": "chat-dev-001",
    "principal": { "userId": "user_demo", "correlationId": "<uuid>" },
    "channel": "chat-dev"
  }
}
```

The Coordinator (`WF-02`) adds a `decision`:

```json
{
  "intent": "plan|review|status|change|clarify",
  "projectId": "prj_... | null",
  "rationale": "short string",
  "question": "optional — only when intent=clarify"
}
```

Mutation sub-workflow input additionally carries:

```json
{
  "operation": {
    "name": "publish_approved_plan|update_task_status|update_task",
    "arguments": { "...": "..." }
  }
}
```

## Rules

- Writes can only pass through WF-05.
- WF-05 refuses any `operation.name` outside the whitelist.
- WF-05 refuses `publish_approved_plan` when `get_approval_status.state !== "approved"`.
- All MCP HTTP calls carry `x-correlation-id` from the request packet.
- `operationId` is captured from every MCP response and threaded back to
  the Coordinator.

## Bounded Planner → Reviewer loop

```
Planner → structured PlanDraft → Reviewer
                                   │
                        issues.severity === "error"?
                                   │
                      yes          │          no
                                   │
                 use revisedPlan  OR  stick with Planner's plan
                                   │
                              → Validate plan → Save draft via MCP
```

MVP applies at most one revision cycle. No unbounded discussion. If the
Reviewer returns malformed JSON the Validate step still runs; failures
are reported through WF-06.

## Service-to-service entry (WF-02)

```
POST http://127.0.0.1:15682/webhook/uapm-multi-agent-core
Authorization: Bearer <configured header value>
Content-Type: application/json

{ "request": { "text": "...", "sessionId": "...",
               "principal": { "userId": "user_demo", "correlationId": "..." } } }
```

Response:

```json
{ "response": "...", "correlationId": "...", "operationIds": [] }
```
