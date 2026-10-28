# Klare KI — KI Project Studio

The existing Astra v2 React application, with one routed UI and a shared mock/live API adapter. React 18, TypeScript, Vite, Tailwind CSS and React Router; German is the default UI language. The technical repository and paths are unchanged.

## Local QA and startup

Tested toolchain: **Node.js 24.15.0 / npm 11.12.1**. The declared Node minimum is 22.12.0; other versions are not covered by this verification. All TypeScript scripts use the declared local dependency, not a global installation.

Before changing the isolated QA clone, inspect its real state. Do not overwrite uncommitted work or switch an unrelated worktree:

```bash
cd /Users/admin/Projects/uapm-frontend-qa
git status --short --branch
git branch --show-current
git rev-parse HEAD
# Continue only on feat/frontend after reconciling any local changes.
cd apps/frontend
npm ci
npm run dev
```

The development server binds only to `http://127.0.0.1:15173` and fails if the port is occupied. It does not start or modify the backend, MCP, n8n or production services.

## Reproducible verification

Use the committed `package-lock.json`. Do not regenerate it during verification and do not use `npm audit fix --force`.

```bash
npm ci
npm run typecheck
npm test
npm run test:smoke
npm run build
npm audit
npm audit --omit=dev
npx playwright install chromium
npm run test:browser
```

`npm run verify` runs typecheck, Vitest, smoke, build and the complete audit after installation. Browser tests start their own loopback-only Vite servers on 15173 and 15174; stop any manually started dev server first. Tests refuse to reuse existing servers. On a minimal Linux host, `npx playwright install --with-deps chromium` also installs required OS packages.

CI performs clean installation, checks the committed lockfile is unchanged, typechecks, runs tests, builds both modes, audits all dependencies and runtime dependencies separately, and captures actual Chromium screenshots. CI has read-only repository permissions. It never commits, merges or deploys. Every gate must pass; per-step continuation exists only to preserve diagnostic evidence.

## Data modes — one interface

Default: `VITE_DATA_MODE=mock`. Demo projects, tasks, approvals and assistant responses are clearly labeled, in memory and reset on reload. They are not backend persistence, real authorization or AI execution.

To use the canonical backend, create an untracked `.env.local`:

```dotenv
VITE_DATA_MODE=live
VITE_API_BASE_URL=http://127.0.0.1:13081
```

Restart Vite. A real backend must be started separately and allow origin `http://127.0.0.1:15173`. Human cookies use `credentials: include`; CSRF remains in tab memory. An existing cookie without a CSRF token requires reauthentication in the current UI. No service token, database secret, MCP credential or model key belongs in frontend environment variables.

Live-mode production compilation is tested. Browser authentication regression tests use explicit intercepted HTTP fixtures; **they are not proof of a running Codex backend, PostgreSQL persistence or live MCP/n8n integration**. See the remaining integration limitations before release.

## Existing product areas

Dashboard; project creation; Project Workspace with list/Kanban and task panels; AI Planning Studio; Plan Review; Approval Center; Project Assistant; Activity & Operations; Settings. The design, routes and components are retained rather than replaced with a second application. Live controls remain limited by the current adapter and backend contract; the full backend acceptance gate is separate from the build/security gate.

## Verified evidence and limitations

The remediation verification in [CI run 40752714322](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/actions/runs/40752714322) passed **28 Vitest tests, 10 smoke checks, 8 Chromium tests**, typecheck, clean installation and both production builds. The complete npm audit and runtime-only audit each reported **zero vulnerabilities**. Later commits are checked again by the same workflow; PR #2 links the final SHA and latest run.

The user's Mac clone was not mounted in the execution environment. These are independent isolated Ubuntu CI results using the requested Node/npm versions, not a claim of commands executed on that Mac. Historical static images under `screenshots/` are not current running-application evidence. Current actual screenshots and JSON/log reports are attached to the relevant CI run under `qa-evidence/`.

- [Build and security remediation](docs/BUILD_SECURITY_REMEDIATION.md): changes, audit analysis, evidence and scope.
- [Live integration](docs/LIVE_INTEGRATION.md): adapter setup and remaining integration work.
- [Backend gaps](docs/BACKEND_GAPS.md): earlier integration questions; some are frontend implementation gaps, not missing server capabilities.
- `docs/ARCHITECTURE_V2.md` and the older API/QA documents are historical design records, not authoritative current verification. The canonical backend OpenAPI remains the source of truth.

PR #2 stays Draft until the separate real-backend and full-system acceptance criteria are satisfied. No merge or production deployment is part of this work.
