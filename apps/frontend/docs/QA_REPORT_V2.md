# QA report — frontend v2

## Executed in this environment (2026-10-28)

- `node scripts/check-syntax.cjs`: **29 TypeScript/TSX files parsed and transpiled; 0 syntax diagnostics**. This is *not* a full typecheck.
- `node scripts/smoke-api.cjs`: **10/10 domain runtime smoke checks PASS**. These test seeded portfolio state, standalone task lifecycle, immutable plan snapshots, diff, stale-ID conflicts, exact-ID approval, revision/rejection, read-only assistant response, proposal isolation, cycle validation and no real operations.
- Static visual mockups rendered in Chromium through `set_content` (in-memory HTML); resulting PNG images were captured. They **are not screenshots of the actual React application**.
- `npm run build`: **NOT PASSING / BLOCKED BY ENVIRONMENT**. The preinstalled environment has no `node_modules` for this app and `npm view react version` produced `EAI_AGAIN registry.npmjs.org`. TypeScript stops with missing `vite/client` and `node` types before application type-checking. No Vite compilation occurred.
- `npm test`: **NOT RUN**; Vitest/React Testing Library dependencies unavailable.
- Browser interaction and actual responsive React layout: **NOT VERIFIED**. Static previews only.

## Manual acceptance test checklist for dependency-enabled environment

1. `npm install && npm run build && npm test` (must all pass before merge).
2. Dashboard: switch project, urgent/open task counts and events match mock API.
3. Create: natural brief and structured form; check new project's board is empty but tasks can be created directly.
4. Board: create task, update assignee/status/priority/dependencies/due date; switch list/Kanban/filter; verify progress changes; Escape closes panel.
5. Planning Studio: add task from text, modify via editor, verify a new immutable version appears.
6. Review: changed task is diffed against approved baseline; correct old/new titles and priority.
7. Approval: confirm fixed ID, approve; verify board publication; attempt stale ID/duplicate approval; reject and request revision in a new project; recreate a draft after rejection.
8. Assistant: read-only answer makes no mutation; proposal remains pending until user applies; apply only makes a draft, not live task changes.
9. Activity: all five operation statuses are visibly labeled examples; retry hints explain safety; no real job is run.
10. Settings: disconnected integrations are optional; no credentials or outbound endpoints.
11. Keyboard-only route navigation, focus/escape in task drawers and create modal, screen reader labels, mobile 375px and desktop 1440px visual QA.

## Known follow-up work

- Full project typecheck and Vitest/UI testing with installed dependencies (release gate).
- Extract remaining inline German strings to locale catalogs and validate EN/RU expansion.
- Approval/publication conflict-resolution and operational task deletion semantics require Backend Lead decision.
- Confirm roles/authorization, backend error envelopes, idempotency and operations/events transport before replacing mock adapter.
