# Klare KI — KI Project Studio: Canonical live adapter (in progress)

Frontend branch: feat/frontend. Source contract: feat/backend-core:packages/contracts/openapi.yaml and docs/backend/integration.md (v1.0.0).

## Development
Demo: `npm run dev -- --host 127.0.0.1 --port 15173` (default mode).
Live: create `.env.local` containing `VITE_DATA_MODE=live` and `VITE_API_BASE_URL=http://127.0.0.1:13081`, then run the same command. Backend must configure ALLOWED_ORIGIN=http://127.0.0.1:15173, including cookie credentials. No secrets belong in Vite variables.

## Implemented live workflows
Human login/logout; session read; real project listing and creation; dashboards; published tasks; optimistic task status transitions; immutable plan list/detail; submit-review; human approve/reject of exact ID + hash; publish; planning operations polling; audit and operation history. All mutations require an authenticated session CSRF token and server idempotency keys. The server is the authority.

## Important limitations
- The previous v2 demo pages remain available when VITE_DATA_MODE is not live; demo outcomes are not backend results.
- Session CSRF is only delivered on login. After page reload, session remains but writes require a fresh login; no CSRF refresh endpoint exists.
- Lost-response writes show an unknown outcome and are not automatically replayed. Durable recovery and stable idempotency keys across page reloads need product decision.
- Project categories, target dates, budgets, task creation, plan draft editing and plan diff are not directly supported by the current canonical API. They are not faked in live mode.
- No live database or n8n E2E test in this delivery; full npm build/typecheck require installed dependencies.
