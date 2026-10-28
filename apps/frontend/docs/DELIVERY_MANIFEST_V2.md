# Frontend v2 package contents

- `src/pages/`: Dashboard, NewProject, Workspace, Review, Approval, Board, Assistant, Activity, Settings.
- `src/components/`: Layout, OperationalTaskPanel, TaskEditor, ProjectPlan, UI.
- `src/api/types.ts`: provisional complete model and ProjectApi logical operations.
- `src/api/mockApi.ts`: in-memory native project and task implementation; no network.
- `src/domain/plans.ts`: plan diff and dependency cycle validator.
- `src/i18n/de.ts`: German UI baseline strings.
- `src/test/`: Vitest tests included but unrun due offline dependency installation.
- `scripts/`: TypeScript syntax check and dependency-free 10-case runtime smoke suite.
- `docs/`: Architecture, API contract, unresolved questions, QA report, handover manifest.
- `screenshots/`: static HTML preview and two Chromium-rendered static previews, not running React captures.
- `README.md`: startup and restrictions.

No GitHub repositories were modified. No production deployment. No external mutations.
