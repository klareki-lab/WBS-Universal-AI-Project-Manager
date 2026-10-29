# G8 integration evidence and remaining release gate

## Changes

- `Projektteam` lets the project owner find active human employees in the project's explicitly associated company, add them as viewers, change their role between viewer and editor, and remove unassigned members. Project leadership cannot be changed or removed here. A member assigned to a published task must first be reassigned through plan review and publication.
- Company membership is explicit. Migration 006 does not assign any existing identity or project to a company. New projects are associated with the creating owner's company only when exactly one is configured. A project owner can explicitly connect a legacy project to their sole company using the team screen; an account in multiple companies requires a separate selection solution. Existing projects and identities are not silently grouped.
- A trusted administrator can use `npm run admin -- create-company` with `COMPANY_NAME`, and `npm run admin -- add-company-employee` with `COMPANY_ID` and `USER_ID`. These commands use the configured database. Provision only identities whose company membership is known; no email-domain inference is used. Company onboarding and authorization of that administrative database access are outside this feature.
- Project creation stores separate description, goals, requirements and optional start/end dates. Existing descriptions remain intact. The stored planning-operation input carries this context and an instruction to use German by default while respecting explicit language requirements. Provider output language is **not guaranteed** by a prompt and has not been tested with a paid model.
- Member changes are recorded as project events. Plan approval and publication still use the immutable version and hash.

## Verification and limitations

- A separate, disposable PostgreSQL service at `127.0.0.1:35467` and a dedicated backend at `127.0.0.1:35468` were created for synthetic G8 fixtures. No existing project or service was modified, and no external model or automation service was used.
- `g8-tests/g8-team-isolated.test.ts` exercises real HTTP handlers and PostgreSQL with synthetic accounts. It tests company and owner authorization, foreign and disabled selection constraints, role and membership changes, audit events, immutable draft assignment versus the published projection, exact-hash approval, publication, and refusal to remove an assigned member.
- `e2e-real/g8-team-real.spec.ts` uses real Chromium, the dedicated backend and PostgreSQL. Three synthetic people are added through the interface; a member is assigned through a draft, which is approved and published; the browser checks the persisted assignment after reload, readable activity, and a non-owner write denial. It also compares the other pre-existing synthetic projects before and after the test. Screenshots and a compact result are in `evidence/g8/`. These are **not** the existing Train Today accounts.
- `e2e-real/g8-brief-real.spec.ts` verifies structured fields and planning input with the dedicated real backend. The external worker is disabled.
- The targeted isolated PostgreSQL suite passed 2 tests; the frontend suite passed 119 unit tests, 10 mock smoke checks, and 18 browser fixture tests. The real-backend team and brief browser checks passed separately.
- The pre-existing assignment-v2 incident has **not** been classified: no query of its original database or audit records was performed. The synthetic regression proves only the tested new case.
- The original 14:29 IT Helpdesk operation has **not** been inspected or classified. No causal claim can be made from the generic error wording. The UI distinguishes several known stored failure categories without inventing the provider's underlying cause.
- Existing Train Today account-to-company membership has not been established. Its 14 accounts and existing owner projects have not been verified. The full legacy backend integration suite was not run because its `beforeEach` truncates tables; the instruction forbids a database reset. G8 is **not a release PASS**.

## Repeatable isolated checks

After starting a dedicated G8 PostgreSQL database at the coordinates enforced in `scripts/seed-g8-isolated.ts`, apply migrations, create the synthetic owner, run that seed, and start the backend with an empty `N8N_ENDPOINT`. The test seed and Vitest configuration reject any database except the dedicated `uapm_g8_test` listener. Then:

```sh
# apps/backend
G8_ISOLATED_DATABASE_URL="$G8_ISOLATED_DATABASE_URL" npx vitest run --config vitest.g8.config.ts

# apps/frontend, with only synthetic fixture credentials in the environment
npx playwright test --config playwright.g8-isolated.config.ts g8-team-real.spec.ts
npx playwright test --config playwright.g8-isolated.config.ts g8-brief-real.spec.ts
npm run build
npm test
npm run test:browser
```

## Owner acceptance before release

1. Confirm the company boundary and explicitly provision the 14 existing synthetic employees and owner into that company without creating new accounts.
2. In an authorized isolated G3 environment, verify existing projects remain unchanged, create a synthetic project, add the three requested existing test employees, and repeat the team, draft, approval, publication, reload and authorization checks.
3. Compare the original assignment-v2 plan status and publication timestamps with its task projection and audit events; classify the 14:29 operation from its stored error and execution evidence, without extracting real personal data or secrets.
4. Confirm language behavior with an approved non-paid stub or separately authorized provider test. Review changes and migrations before any deployment.
