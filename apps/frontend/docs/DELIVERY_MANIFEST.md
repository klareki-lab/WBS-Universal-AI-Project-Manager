# Delivery Manifest — Kompass Frontend Workstream

- Application: React 18, TypeScript 5, Vite 6, Tailwind CSS 3, React Router 6.
- Routes: dashboard, new project, AI workspace, review, approval, board, integrations, activity.
- Data layer: `ProjectApi` interface + mock implementation + configurable route-less transport.
- Demo interaction: project creation from free text; chat messages; add draft task; edit draft task; version fork; confirm exact-version demo approval; list/Kanban and filters.
- Read-only external systems: Jira integration disconnected, preview never executable, sync states illustrative, zero actual Jira issue keys.
- Documentation: setup, draft API contract, unresolved questions, UX architecture, QA status.
- Visual assets: two Chromium-rendered static layout previews and self-contained HTML reference.
- Validation: 6/6 mock business-logic smoke tests passing; 26/26 TS/TSX files parse without syntax errors. Full bundler/typecheck/Vitest blocked by missing npm registry access.
- Repository operations: none. No existing WBS repositories changed. Production deployment: none.
