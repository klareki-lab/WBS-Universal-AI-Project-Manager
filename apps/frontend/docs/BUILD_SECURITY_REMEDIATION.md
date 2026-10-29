# Frontend build and security remediation

Product: **Klare KI — KI Project Studio**  
Source: `feat/frontend`, starting at `091e37d6df5214c1ec91ccc50edb45d3002f563c`  
PR: [#2](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/pull/2)  
Date: 2026-10-28

## Scope and execution environment

This addresses the TypeScript build gate, dependency vulnerabilities, reproducible installation and regression evidence without replacing the established Astra v2 UX. Only frontend-owned files and a dedicated frontend CI workflow change. No backend/MCP worktrees, main branch or production services were modified.

`/Users/admin/Projects/uapm-frontend-qa` is not mounted in the assistant environment. Its local status and uncommitted files were not inspected or changed. The connected GitHub API confirmed the source SHA before edits; all branch updates used a matching expected head and no force. Actual commands ran in an isolated GitHub Actions Ubuntu runner with **Node 24.15.0 and npm 11.12.1**. Checkout status and commit IDs are recorded in `qa-evidence/environment.log`.

## Repairs

### TS2345: navigation groups

`Layout.tsx` previously inferred the global navigation array from two literal German labels. Typing the renderer as `typeof global` then rejected the different local/system labels. A shared `NavigationItem` (`label: string`, `path: string`, `Icon: LucideIcon`) now types every group and the renderer. No `any`, assertion, `@ts-ignore`, disabled strictness or decorative redesign was introduced.

### TS2769: Vite/Vitest dependency types

Vite 6 plus Vitest 2 brought incompatible Vite plugin type trees. The installed graph now has **Vite 6.4.5 deduplicated** under the app, plugin-react and Vitest/mocker. `defineConfig` remains the typed `vitest/config` export. The fix is dependency alignment, not a cast.

| Package | Selected / resolved version | Role |
| --- | --- | --- |
| vite | 6.4.5 | Development/build tooling |
| vitest | 4.1.12 | Test tooling |
| @vitest/mocker | 4.1.12 | Test tooling, transitive |
| @vitejs/plugin-react | 4.7.0 | Development/build tooling |
| esbuild | 0.25.12 | Development/build tooling, transitive |
| react-router-dom / react-router | 7.18.5 | Browser runtime |
| @playwright/test | 1.62.1 | Browser QA tooling |

React 18, Tailwind 3 and the existing declarative route structure remain. The Router 7 and Vitest 4 upgrades were deliberate version changes and were tested rather than applied with `npm audit fix --force`. No dependency overrides or audit exclusions are used.

### Lockfile and tooling portability

npm generated a lockfile v3 in isolated CI, then `npm ci` installed it and all gates passed. A one-time guarded job committed **only** that tested lockfile to `feat/frontend` at `db24f1d51184e2e0c1c4b82ef7fbc740e968c21d`. The bootstrap writer was subsequently removed: normal CI requires the committed lockfile, uses read-only credentials and cannot generate or commit dependency changes.

Verified lock Git blob: `f1e39a74441d4b495766e73e852ed6822a2dc6dc`  
Verified lock SHA-256: `c0bc24ca0d5ca0bc8cc8f9751070243072985ae3a3f38ba656a697da4cb75dfe`

Both legacy Node scripts now resolve the project's `typescript` dependency. The hardcoded global `/opt/nvm/...` fallback is removed. Vite dev/preview bind to loopback; Vitest API mode is disabled. Production deployment must serve `dist/` as static assets and not expose Vite or Vitest development servers.

## Security findings: runtime versus tooling

The original manifest was resolved in a separate temporary directory solely for audit, with install scripts disabled. Its audit reproduced **8 affected package entries: 5 moderate, 1 high, 2 critical**. This is a fresh resolution of the original manifest, not the unavailable lockfile from the user's Mac. Package-entry totals are not counts of unique CVEs.

| Original affected package entry | npm severity | Classification / disposition |
| --- | --- | --- |
| react-router | moderate | Runtime. Patched via 7.18.5. |
| react-router-dom | moderate | Runtime parent affected via router; patched via 7.18.5. |
| vitest | critical | Development/test. Replaced by patched 4.1.12. |
| tinypool | critical | Development/test transitive chain; absent from final lockfile. |
| vite (nested old test-tool chain) | high | Development/test; incompatible vulnerable copies removed by deduplication to 6.4.5. |
| @vitest/mocker | moderate | Development/test; updated to 4.1.12. |
| vite-node | moderate | Development/test transitive chain; absent from final lockfile. |
| esbuild | moderate | Development tooling; resolved to 0.25.12. |

Runtime advisories [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) (open redirect) and [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) (SSR error hydration) mark versions below 7.18.0 as affected. The latter explicitly excludes declarative mode, which this app uses; nevertheless the affected dependency was upgraded rather than suppressed. The open-redirect finding must not be dismissed merely because the second advisory is SSR-specific.

Tooling advisories include [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), and the tinypool [worker options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) / [run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) issues. These dependencies are not browser runtime code, but can endanger development/CI. They were remediated, not accepted as harmless.

Final complete audit: **0 info / 0 low / 0 moderate / 0 high / 0 critical**.  
Final `npm audit --omit=dev`: **0 vulnerabilities**.  
No audit finding was suppressed. Audit results describe the registry database at the time of the run; they are not a guarantee against all application vulnerabilities.

## Tests actually executed

Evidence run: [40752714322](https://github.com/klareki-lab/WBS-Universal-AI-Project-Manager/actions/runs/40752714322), source `e911cb0ffbc1c3a3e71b4912bdd1c2709d0db2c2` using the exact lockfile later committed above. The final read-only workflow runs again from the final branch head; PR #2 records that result.

| Gate | Result |
| --- | --- |
| npm ci | PASS |
| npm run typecheck | PASS |
| npm test | 28/28 PASS, 4 files |
| npm run test:smoke | 10/10 PASS |
| npm run build, demo | PASS |
| npm run build, live | PASS |
| npm audit --json | PASS, 0 findings |
| npm audit --omit=dev --json | PASS, 0 findings |
| npm run test:browser | 8/8 PASS; 0 skipped, 0 flaky |

19 added Vitest cases cover shared adapter selection, no silent live-to-demo fallback, canonical status/priority preservation, unsupported-operation refusal, credentialed login, memory-only CSRF, session reauthentication, malformed login responses, 401 and 403 handling, logout, exact optimistic version transport, conflict/request IDs, explicit idempotency-key reuse, malformed success responses, unknown write outcomes, and read-only operation polling. Existing 9 tests are retained.

The HTTP client no longer marks a malformed successful login as authenticated or a malformed 2xx write response as success. It clears stale CSRF after authentication expiry/rejection. A network-interrupted mutation is not automatically replayed. This does not add durable mutation recovery across browser restarts; that remains a broader integration task.

## Actual browser evidence

Chromium launches the real React/Vite app in isolated processes. Four desktop/mobile demo tests exercise branding, responsive viewport, the existing full navigation and list/Kanban controls. Four live-mode tests use explicit HTTP fixtures for expired session, invalid credentials, reauthentication after reload and successful login/logout. Screenshots capture rendered pages, not separately authored static HTML:

- `qa-evidence/screenshots/desktop-demo-dashboard.png`
- `qa-evidence/screenshots/desktop-demo-board.png`
- `qa-evidence/screenshots/desktop-demo-planning.png`
- Corresponding `mobile-demo-*.png` files.
- `qa-evidence/screenshots/live-mode-login-http-fixture.png`.

Reports/logs: `environment.log`, `dependency-tree.log`, `npm-ci.log`, `typecheck.log`, `vitest.json`, `vitest.log`, `smoke.log`, `build.log`, `build-live.log`, `audit-all.json`, `audit-runtime.json`, `playwright.json`, `browser.log`. The baseline run additionally retains `audit-baseline.json`. Download evidence from the named Actions run before its 14-day retention expires; screenshots are not committed as binaries.

## Remaining acceptance boundaries

**Build/dependency-security remediation: PASS for the verified scope. Full product integration: still gated.**

- These tests do not access the user's Mac clone or a real Codex/PostgreSQL backend. HTTP fixtures test frontend behavior, not backend authorization enforcement or persistence.
- The live adapter's broader product gaps (including complete project creation field mapping, approval response mapping, publication controls, safe durable recovery and unsupported planning controls) are not solved by a clean build. Frontend/API integration owners must finish and test those separately.
- Session reload currently requires a fresh login to obtain CSRF. The transport supports read-only requests, but the session gate does not provide a dedicated read-only application mode.
- Backend/MCP/n8n end-to-end acceptance remains with the respective workstream owners and Integration Lead. No AI execution is claimed.
- Production should serve only static build output with the application's backend security controls. Neither `vite dev` nor `vite preview` is a production server for this handover.

No merge, unrelated branch modification, secret addition or production deployment was performed.
