# Kompass v2 — standalone frontend architecture

## Scope and reuse

This is an adaptation of the v1 React/Vite/Tailwind UI, not a fresh product. Retained: sidebar/topbar, dashboard design, project form, split planning studio, phase/task editor, plan snapshots, review layout, Kanban/list board, activity styling, app context, API adapter boundary. Replaced: Jira issue links, Jira synchronization/approval, integration-first navigation. Added: a native operational task store, agent proposal lifecycle, direct task creation and editing, plan diff, reject/request-revision, operation status examples, settings.

## Product information architecture

- Dashboard → all projects, progress, urgent tasks, due dates, activity.
- Create Project → natural-language brief or structured form. Freestyle mode uses a **clearly disclosed local rule**, not AI, to derive name and default date.
- Project Workspace → independent task list/Kanban, filters, native task creation and editing, people, dependencies, deadlines.
- AI Planning Studio → chat-like demo + plan snapshots and task editor; no model calls.
- Plan Review → compare proposed immutable snapshot with approved snapshot; inspect warnings and edit task in new draft version.
- Approval Center → approve exact immutable version, reject, request revision, create draft from approved snapshot.
- Project Assistant → read-only local answers vs separate proposed changes; proposals must be applied into a draft, reviewed, then approved.
- Activity & Operations → local event log + five **illustrative** operation states and retry policy text.
- Settings → backend/memory/AI state and optional integrations. No connection needed for native work.

## Architectural boundaries

```
React pages and shared components
            |
     ProjectApi interface  (src/api/types.ts)
            |
     mockApi in-memory adapter (src/api/mockApi.ts)
            |
      no outgoing requests

FUTURE ONLY:
React → our authenticated API → PostgreSQL (system of record)
                            ↘ n8n orchestration → our MCP tools
                            ↘ optional external integrations
```

There is no direct browser access to OpenAI, Atlassian, PostgreSQL, n8n, or MCP. Backend must enforce permissions and validate mutations. `src/api/httpTransport.ts` is only an unconfigured transport, not a final endpoint map.

## Important invariant: plans versus work

- `PlanVersion`: versioned *planning snapshot*; phases, tasks and warnings are cloned on every edit, not mutated in place. `status` lifecycle metadata can change. Approve only `activeDraftVersionId` matching the supplied `planVersionId`.
- Operational `Task`: mutable native project task. Kanban and list read this operational store. Direct task creation/editing requires **no AI or approved plan**.
- Local approval publishes the plan's planning fields to the operational store, retaining existing task completion status and assignee; removed plan tasks are **not** auto-deleted from the operational store (the deletion/conflict policy is pending backend decision).
- `ChangeProposal` remains `pending` until explicitly applied/rejected. Applying produces a *new draft*, never an approved plan or an automatic board mutation.
- AI answers are `kind: read_only`; proposals are `kind: proposal`. The local demo response is rule-based and has no actual model inference.
- `OperationJob` entries are fixed illustration only. No queue, retry, or external action is implemented.

## UI component structure

- `components/Layout.tsx`: responsive side navigation, project switcher, status banner, keyboard Escape for navigation drawer.
- `components/OperationalTaskPanel.tsx`: focused task details/editor with keyboard Tab trap and Escape dismissal.
- `components/TaskEditor.tsx`: *planning snapshot* editor; saving forks a new plan version.
- `components/ProjectPlan.tsx`: phase/task hierarchy and action hooks.
- `components/UI.tsx`: cards, statuses, loading/errors, accessibility text and progress.
- `context/AppContext.tsx`: selected project and global refresh only (not business state authority).
- `domain/plans.ts`: diffing and cycle detection, no UI dependencies.
- `api/mockApi.ts`: in-memory isolated fixture data and deterministic behavior.
- `i18n/de.ts`: German baseline copy; secondary inline literals still require extraction during final i18n QA.

## Security/accessibility

Demo banner appears on every screen. No secrets or endpoints. APIs require backend authorization after integration. Semantic buttons/links, keyboard Tab navigation, Escape handling, labeled forms, status text and loading/error states are present. Formal WCAG testing with running React app remains pending dependency installation.
