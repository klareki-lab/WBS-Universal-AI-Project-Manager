# G8: owner-side preflight and incident diagnostics

## Current evidence and boundary

[G7_EMPLOYEES.md](G7_EMPLOYEES.md) records that the selected v2 draft had not been approved by the integration operator and that published tasks were unchanged immediately after draft creation. It does not establish what happened subsequently, or what the browser displayed at the reported time. **Incident A: INSUFFICIENT EVIDENCE.** The checked-in reports do not identify the relevant 14:28/14:29 IT Helpdesk operations or their stored failure classification. **Incident B: INSUFFICIENT EVIDENCE.**

The G8 migration defines `companies` and `company_employees`, but no checked-in evidence identifies the Train Today company by database ID, proves that migration 006 was applied to G3, or supplies the complete 14-account roster. It does not define a company-membership audit table or guarantee that an insert trigger is an adequate audit record. Therefore association is **not approved to proceed by this report**: exact identity, company isolation and the applicable audit requirement still need owner-side verification.

## Run the read-only exporter locally

The Product Owner runs this in the authorized isolated G3 environment. Do not send credentials, private records, a database URL, or the roster to the assistant or GitHub. Use a database role restricted to `SELECT` on the required tables. Configure `G8_DIAGNOSTICS_DATABASE_URL` in that terminal through the owner's existing secure local mechanism; the command below neither reads a secrets file nor prints this variable. Confirm independently that the loopback connection is the isolated G3 database and not a tunnel to another environment. The exporter checks the requested local database name but cannot independently establish provenance.

Prepare a protected manifest with **the existing 14 fictional account UUIDs**, in the owner's verified order, and the actual company UUID established from an authoritative company record. Do not create or rename accounts. The manifest must be an owner-only regular file under the ignored `.g3` directory and contain exactly:

```json
{"companyId":"<company-uuid>","userIds":["<account-uuid-1>","<account-uuid-2>"]}
```

The example is intentionally incomplete: supply all 14 distinct UUIDs. Names and email addresses do not belong in the manifest. The owner must verify that each UUID is the intended fictional account; the exporter cannot establish this from an identifier alone. Obtain the IT Helpdesk project UUID from the owner's authorized local project context; the exporter never searches by project name.

From the integration worktree, in a terminal where the read-only database URL is already securely configured:

```sh
cd /Users/admin/Projects/uapm-integration-g3
umask 077
mkdir -p .g3/g8-owner-diagnostics
chmod 700 .g3/g8-owner-diagnostics
# Create .g3/g8-owner-diagnostics/manifest.json locally and set mode 600.
cd apps/backend
export G8_CONFIRM_LOCAL_ISOLATED=YES
export G8_EXPECTED_DATABASE_NAME='<exact-isolated-database-name>'
export G8_HELPDESK_PROJECT_ID='<verified-helpdesk-project-uuid>'
export G8_DIAGNOSTICS_PARENT="$PWD/../../.g3/g8-owner-diagnostics"
export G8_MEMBERSHIP_MANIFEST="$PWD/../../.g3/g8-owner-diagnostics/manifest.json"
npx tsx scripts/g8-diagnostics.ts
```

Output is a newly created owner-only directory and a mode-0600 `diagnostics.json` beneath the ignored `.g3` tree. The transaction is `REPEATABLE READ READ ONLY`; it performs only fixed scoped selects, never issues a mutation or initiates an AI operation, and accepts only a numeric loopback URL without query parameters and rejects a mismatched database name. It reports plan and operation statuses, timestamps, matched assignment booleans, approval/hash consistency and ordered audit events. Error text is mapped to a small known-code allowlist; unknown errors become `UNCLASSIFIED`. Tokens, prompts, task descriptions, names, emails and account IDs are excluded. Operation and task references are per-export pseudonyms. A current task row alone cannot prove what a browser displayed earlier.

The optional membership preflight reports a verified company UUID, per-manifest-index existence and active-human status, target and other-company membership counts, project-role counts, pair uniqueness, and enabled insert-trigger count. It does not expose account IDs. `ready_to_associate` is always false: a trigger's presence cannot establish compliance with an unstated audit policy. The roster and audit policy must be reviewed separately. Missing company tables, a missing company, any unknown or inactive account, an association to any other company, or missing uniqueness means **stop**. If the company schema is absent, do not apply a migration without separate authorization.

## Association and rollback plan

No association statement is executed by the exporter. Before an authorized owner-side write, preserve the protected manifest and preflight report, verify all 14 indices against the fictional roster, verify the company UUID against an authoritative record, and establish the required durable audit record with the owner. The current schema has no declared company-membership audit facility; an enabled trigger count by itself is not sufficient proof. Do not proceed until that audit gap is resolved.

When the audit requirement and schema are confirmed, the minimal change must be one transaction inserting only missing `(company_id, user_id)` pairs, using the verified company UUID and the 14 manifest IDs and `ON CONFLICT (company_id,user_id) DO NOTHING`. Recheck active-human identities, company ID, cross-company associations and existing target links **inside the same transaction**, with a lock that prevents concurrent company-membership changes during validation and insertion. The transaction must fail closed on any mismatch. Do not update users, passwords, project memberships, task rows, plans or approvals. Capture the exact IDs actually returned by `INSERT ... RETURNING` in an owner-only rollback journal before committing, along with database identity and the approved audit reference. If the journal cannot be safely retained, roll back the transaction.

Rollback is limited to those returned IDs, never all 14 manifest entries: after verifying the same isolated database and company and confirming no subsequent change or use of those links, delete exactly the newly inserted pairs in a separately audited transaction. Leave links that existed before the operation untouched, and do not change project roles, tasks, plans or approvals. If later usage or the audit record cannot be safely reconciled, stop and perform a reviewed recovery instead of deleting blindly. Because the actual schema state, roster and audit policy are unknown, this document does not provide an executable write command or claim a 14/14 result.

## Reading the sanitized report

- **Incident A:** compare the selected version's state and publication timestamp, the project's current published version, matching task source/version/assignment booleans, approval and revocation records, and ordered audit events. A draft with no publication plus matching current assignment is a reason to investigate, not by itself proof of an earlier screen exposure. Historical browser or timestamped projection evidence may still be necessary.
- **Incident B:** inspect each pseudonymous operation's timestamps, state, allowlisted classification and correlated ordered events. `UNCLASSIFIED` means the retained data does not identify the cause; do not infer a provider or credential failure. The window is 14:27–14:31 in `Europe/Berlin`, including operations created or last updated within it.
- The owner may share the sanitized report only after checking it for sensitive information. Never share the private manifest, URL, credentials or original database rows.

## Closure verification record

- Target company association: **0/14 verified or performed**. The complete roster, target company identity, G3 schema state, and company-membership audit requirement are not present in the approved evidence. Existing fictional employees were not created, modified or assigned.
- G3 membership acceptance: **NOT VERIFIED**. The existing G3 service and its private records were not accessed. In a separate dedicated synthetic PostgreSQL/backend, the team workflow was rerun in Chromium and passed, including three synthetic members, assignment after approval and publication, unchanged pre-existing synthetic projects, a 403 for an editor attempting team management, and zero intercepted paid-provider requests.
- Five isolated PostgreSQL tests passed across the G8 team and diagnostics suites. They cover authorization, company separation, unapproved assignment isolation and exact-hash rejection, and the exporter's read-only transaction, redaction, 14-index preflight, cross-company and disabled-user detection, and remote-host/URL-override rejection. The CLI was also run against that separate synthetic database with a synthetic 14-ID manifest; it produced a mode-0600 JSON file in a mode-0700 ignored directory and correctly reported `ready_to_associate: false`.
- A separate browser test confirmed that plan and activity technical identifiers are collapsed in ordinary UI. German is requested by a stored planning instruction, but actual model output language is **NOT VERIFIED** without a suitable no-paid-call provider stub or separately authorized test.
- G8 release result: **FAIL / incomplete acceptance**. The synthetic checks cannot establish a 14/14 association, actual G3 membership behavior, or either original incident's cause.
