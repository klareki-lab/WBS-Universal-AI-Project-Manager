# Frontend integration handover

Target: `klareki-lab/WBS-Universal-AI-Project-Manager`
Target branch: `feat/frontend` ONLY
Base branch for proposed PR: `main`
Target directory: `apps/frontend`

## Publication status

published in feat/frontend (initial version at 868fca635b9ffb453d9b2c17b773162ef837444b): GitHub connector reports `pull: true`, `push: false` for authenticated user `Herman879`. No commit or pull request was created, and no repository branch was modified.

Existing `feat/frontend` head when checked: `668dea8eaea0a0122e669c76a360cb1a67e4d4b0`.

## Installation instructions for repository owner

From repository clone:

```bash
git fetch origin
git checkout feat/frontend
# Copy the apps/frontend directory from this package into the repository root.
git add apps/frontend
git commit -m "feat(frontend): add standalone project manager frontend v2"
git push origin feat/frontend
# Then open a PR from feat/frontend to main (do not merge).
```

## Local startup

```bash
cd apps/frontend
npm install
npm run dev
```

Tests and production build:

```bash
npm run test:smoke
npm run test
npm run typecheck
npm run build
```

## Implementation and simulation boundaries

The frontend includes native project and task management, plan versioning, a mock AI assistant, activity feed, and operation UI. All data flows through an isolated mock API adapter. There is no real persistence, AI call, permission enforcement, backend connection or MCP integration. No credentials are included. See `apps/frontend/docs/` for contracts and unresolved decisions.

## Verification

Source archive prepared and `index.html` entrypoint repaired. Build and complete React browser tests require npm dependencies not currently present in this environment; do not treat them as passed.
