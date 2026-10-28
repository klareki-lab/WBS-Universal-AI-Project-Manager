# Klare KI — Universal AI Project Manager Frontend v2

Standalone native project-management frontend with optional AI-style planning and proposals. Built with React 18, TypeScript, Vite, Tailwind CSS and React Router. Default language: German.

## Run locally

Requirements: Node 20+ and npm, with access to the npm registry.

```bash
npm install
npm run dev
```

Open the local address printed by Vite (normally `http://localhost:5173`).

```bash
npm run build           # typecheck + Vite production build
npm test                # Vitest + React Testing Library
npm run test:smoke      # dependency-free domain behavior smoke (global TypeScript required)
node scripts/check-syntax.cjs
```

**Known validation limitation of this delivery environment:** npm registry DNS was unavailable, so package installation could not be completed. Thus actual Vite build, React rendering tests and responsive browser QA of the React app were **not** verified here. The syntax/transpilation check and direct mock API smoke tests ran successfully, and the design previews are static examples, **not** actual screenshots of the running React application. Install dependencies and run the above commands before integration. `scripts/check-syntax.cjs` and `scripts/smoke-api.cjs` reference the system global TypeScript path for this environment; adapt if different.

## Eight MVP areas

1. Dashboard — multiple projects, progress, health statuses, urgent tasks, due dates, recent changes.
2. Create Project — free text or structured form. Free text uses transparent local defaults, **not AI**.
3. AI Planning Studio — conversational demo plus editable versioned phases/tasks/dependencies.
4. Plan Review & Approval — comparison with approved baseline, exact-version approval, rejection, revision request.
5. Project Workspace — native editable tasks, list/Kanban, status/priority filters, assignees, deadlines, dependencies.
6. Project Assistant — read-only answers versus proposal actions, explicit application into a draft.
7. Activity & Operations — local events and five labeled illustrative operation states with retry guidance.
8. Settings — application status and optional, disconnected integrations.

## Demo restrictions

**All data is in memory and resets on reload.** Starter projects, approvals, event logs and operation cards are artificial examples, labeled throughout. A local approval is only a UI/domain demonstration, **not** real authorization. No model calls, no n8n/MCP calls, no PostgreSQL connection, no external sync, no actual job execution, no secrets, no production deployment, no Jira required. Everything stateful uses `src/api/mockApi.ts` behind `ProjectApi` in `src/api/types.ts`. The real backend will replace the adapter after contract reconciliation.

## Handover

- `docs/ARCHITECTURE_V2.md`: reused UI, navigation and native state model.
- `docs/API_CONTRACT_DRAFT_V2.md`: provisional logical operations, no final endpoints.
- `docs/CONTRACT_QUESTIONS_V2.md`: open decisions for Backend Lead.
- `docs/QA_REPORT_V2.md`: tests actually run and known limitations.
- `screenshots/v2-*-preview.png`: **static visual design previews**, not running React screenshot.

No existing WBS Employee Onboarding or Messe Hub repository has been changed.
