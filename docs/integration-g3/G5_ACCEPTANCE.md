# G5 clean workspace and AI lifecycle — in progress

**Status: NOT COMPLETE.** The real frontend project exists; no G5 AI request, plan, approval or publication exists. The Product Owner has not yet supplied a recorded Development Mode spending authorization and warning preference. Human approval will be a separate, explicit decision on the exact generated plan version and hash. Do not simulate either decision.

## Preservation and isolation

The existing G3 PostgreSQL volume was not reset and no existing project, approval or audit record was deleted. Before creating G5, a PostgreSQL custom-format dump was stored in the ignored, local-only, mode-0700 `.g3/backups` directory:

- `.g3/backups/g5-uapm-g3-20261029T102400Z.dump`, mode 0600, SHA-256 `b678ade57b3ec7f3e8efa8379db9f4be8292e089478cfb5f142ecaf1e9407eac`.
- The dump was fully restored with `pg_restore --exit-on-error` into a newly created temporary verification database on the same isolated G3 PostgreSQL server. Counts matched: 35 projects, 37 plans, 86 tasks, 32 operations, 23 approvals, 7 revocations and 213 audit events. Only that newly created verification database was then removed. A local mode-0600 inventory containing IDs, status and provenance classifications is `.g3/backups/g5-inventory-20261029.json`; it is intentionally not committed because names may be sensitive.
- 34 project names were marked synthetic by their names, which does not establish ownership; one is the owner-created G4 project. All were retained. The backup predates the new G5 project and cannot restore subsequent changes by itself.
- The real acceptance ledger remains in its existing protected location with three calls; no development ledger existed at inspection. Existing credentials and historical evidence remain in place. No ledger or credential was deleted or copied.

The owner session uses **Projektfokus**, a reversible, tab-scoped display filter. It shows the selected project on the dashboard and in the selector; it is **not database isolation or an authorization boundary**. Turn it off to show all previously accessible projects. No data or access rights change. The selected project and focus preference survive reload within that tab. Application reads remain live backend reads, with no fixture fallback.

## Prepared project

- Frontend: `http://localhost:25174` (same-origin loopback proxy to the isolated G3 backend).
- Project: **Einführung eines mehrsprachigen KI-Kundenassistenten**.
- Project ID: `8c21ac99-b09a-41dd-bfa9-8f81e97f1be9`, created through the frontend by the existing human session. The business goal is stored as the project description.
- PostgreSQL: draft, base project version 1, one human owner, two project audit events; **0 operations, 0 plans, 0 tasks, 0 approvals** at preparation.
- Human session, focused Dashboard, Planning Studio, empty Kanban and project-scoped real Activity were observed in the existing browser. The `project.created` event is present.

## Stage results

| Stage | Result |
| --- | --- |
| Backup, full restore verification and protected inventory | PASS |
| Reversible focused live workspace and real project creation | PASS |
| Credential reference and isolated services | PASS for metadata presence only; provider connectivity not tested |
| Development spending authorization and warning preference | BLOCKED: Product Owner decision required |
| Submit AI goal; Coordinator, Planner, Reviewer and provider usage | NOT VERIFIED — no request made |
| Generated plan, phases, tasks, dependencies and human review submission | NOT VERIFIED |
| Product Owner approval of exact version/hash | NOT VERIFIED — must be performed by the owner |
| Publication, task status change, reload, Kanban/List and final audit | NOT VERIFIED |

## Safe continuation

1. Obtain and record the Product Owner's explicit Development Mode spending authorization and informational USD warning threshold. A warning is not a cap; do not infer authorization from the credential or previous G3 acceptance decision.
2. Follow [Development Mode setup](DEVELOPMENT_MODE.md). Verify zero in-flight G3 jobs before updating only the dedicated G3 backend/n8n AI workflow and guard. The currently running guard is the exhausted acceptance process; the revised G4 AI workflow and development guard have not been activated. Preserve both ledger paths and credentials. Do not create a new infrastructure service or alter production.
3. In the existing project, submit the stored business goal once through Planning Studio. Inspect actual operation, stage execution IDs, provider usage and provenance; do not relabel fixtures as AI output. If it fails, inspect the same operation and ledger before considering another request.
4. Validate the immutable plan's phases/tasks/dependencies and submit it for review. Stop and give the Product Owner the exact plan ID, version and content hash. Only the Product Owner may approve it in the UI. After genuine approval, publish and verify the same project's tasks, supported status update, reload and audit history.

## Rollback and recovery

For the presentation filter, uncheck **Projektfokus**; no database recovery is needed. To verify or recover the pre-G5 backup, first compare its SHA-256 and restore it into a **new, separately named** database using the isolated server's PostgreSQL 17 `pg_restore --exit-on-error --no-owner --no-privileges`. Do not overwrite or reset `uapm_g3`: it contains the new G5 project and potentially newer work. Decide any actual switchover only after reviewing the restored copy and the changes made since the backup. Keep the existing SQLite ledgers and their WAL files untouched. Backups and inventories are local and must remain protected; no credentials belong in reports or Git.
