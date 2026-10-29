# MCP Prompts

Prompts are reusable instructions available for discovery via `prompts/list`
and retrieval via `prompts/get`. They contain **no secrets** and make
**no claims of user authorization**.

## `plan_project`

Arguments:

- `goal` (required): the project goal, 1–2 sentences.
- `domain` (optional): e.g. `software`, `marketing`, `event`, `operations`.
- `constraints` (optional): deadlines, budgets, dependencies.
- `knownUnknowns` (optional): missing info to flag as assumptions.

The returned user message asks the model to produce a JSON `PlanDraft`
following the schema used by `uapm-mcp`. The prompt forbids inventing
confirmed owners/dates and requires measurable Definition of Done.

## `review_project_plan`

Arguments:

- `planJson` (required): serialized `PlanDraft` to review.
- `focusAreas` (optional): e.g. `timeline`, `dependencies`, `owners`.

Returns an instruction set to produce a structured review with:

```json
{
  "ok": true,
  "issues": [{ "severity": "info|warning|error", "taskRef": "tempId|null",
               "category": "clarity|duplicate|phase|dependency|timeline|owner|dod|unsupported_claim",
               "message": "...", "suggestion": "..." }],
  "revisedPlan": null
}
```

The reviewer is instructed to catch duplicates, dependency cycles, impossible
timelines, missing Definition of Done, and unsupported owner/date claims.
