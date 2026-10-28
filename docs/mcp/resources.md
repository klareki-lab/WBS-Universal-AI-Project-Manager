# MCP Resources

Both resources are read-only and permission-checked (same rules as `get_project`).
Clients that do not support dynamic resources can use the equivalent read tools
(`get_project` + `get_project_progress`, and the "current published plan"
is obtained by scanning plan versions for status=published).

## `project://{id}/overview`

Returns:

```json
{
  "project": { "id": "...", "name": "...", ... },
  "progress": {
    "counts": { "total": N, "byStatus": {...} },
    "overdue": N,
    "blockers": [{ "taskId": "...", "reason": "..." }],
    "completionRatio": 0.0,
    "updatedAt": "..."
  }
}
```

Access denied → single text content with `{"error": {"code":"forbidden", ...}}`.

## `project://{id}/plan/current`

Returns:

```json
{
  "projectId": "...",
  "planVersion": PlanVersion | null
}
```

`planVersion` is `null` when no plan has been published. Clients MUST treat
`null` as "no current plan" rather than an error.
