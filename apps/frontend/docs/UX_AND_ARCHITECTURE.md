# UI / Architecture Notes

## Information architecture

Global desktop sidebar with Overview, Planning and System groups; responsive mobile drawer; active link and selected project context; skip-to-content link. Eight dedicated routes and a global demo warning. German copy is centralized in `src/i18n/de.ts` for eventual `en.ts` or locale-loader replacement.

| Screen | Reusable presentation | Primary interaction |
|---|---|---|
| Dashboard | `Card`, `ProgressBar`, `StatusBadge`, project tiles | Open project / new project |
| New Project | labeled form, target date, constraints | Save local project + generated rule-based draft |
| Workspace | `ProjectPlan`, demo conversation, `TaskEditor` | Edit task, create new version, adopt message as demo task |
| Review | `ProjectPlan`, warnings, dependency list | Inspect and return to edit |
| Approval | version snapshot, Jira change preview, confirmation | Confirm exact immutable version ID, demo only |
| Board | Kanban + list, `ExternalIssue` | Status filter, task details |
| Integrations | status overview, sync-state catalog | Guidance only; no real connection controls |
| Activity | chronological local events | Inspect history (no fake backend provenance) |

## Accessibility

- Semantic nav/main/sections, accessible labels, focus-visible styles, skip link and `aria-live` on chat.
- Forms associate labels with controls; loading uses `role=status`, errors use `role=alert`, status also conveyed as text.
- Mobile drawer is opened/closed via native buttons; task editor closes on Escape, receives initial input focus.
- **Known enhancement before production:** full focus trap and restore-focus in dialogs/mobile navigation; announce success in a centralized toast live region; accessible cross-column Kanban keyboard movement if drag/drop is later introduced.

## Security boundaries

- Browser has no model or Jira credentials; mocks never make network calls.
- `ProjectApi` port separates UI from transport and server persistence.
- No real issue URLs appear until an API supplies a verified Jira issue reference.
- Production must implement tenant isolation, authz, immutable snapshot storage, optimistic locking and server-side validation independently of the frontend.

## UX modes

- **DRAFT:** amber label, task editor enabled, saving forks a fresh ID.
- **APPROVED:** green label, plan displayed read-only, no editing in place.
- **SIMULATED:** persistent beige banner and explicit copy on every dangerous operation.
- **SYNC:** five states displayed as a *reference catalog*, not actual event history; states `partial` and `running` prohibit blind retry.

## Visual system

Slate/navy sidebar, emerald accent, generous white cards, amber alerts, restrained status color, readable 14–16px body typography, CSS mobile breakpoints and no dependency on third-party images or fonts. Screenshot reference is a static design approximation, not claimed as browser proof of the React build.
