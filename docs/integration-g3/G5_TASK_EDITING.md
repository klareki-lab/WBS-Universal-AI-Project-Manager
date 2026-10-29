# G5 task content editing — integration verification

Astra's frontend delta `5eea6d6..ed50bdd` is integrated on `feat/integration-g3`. The conflict in `LivePlanWorkspace` preserves exact `?plan=` selection, loading state, operation status and failure guidance. G5 project focus remains unchanged. The running frontend at `http://localhost:25174` serves the new panel through the existing same-origin proxy; the backend, PostgreSQL, n8n, MCP and AI budget guard were not restarted or reconfigured.

## Runtime evidence

The existing Astra real-backend Playwright scenario ran against the actual G3 backend and PostgreSQL through localhost:25174, using a separate synthetic human-role test account and a new project named `SYNTHETISCH Task editor acceptance` (`145fd443-eb0f-47e7-9948-5883ecd68634`). This project remains in the database as test evidence; nothing was cleaned or reset. Its automated approvals were test fixtures, not Product Owner decisions.

- The second of two published tasks was opened and **Inhalte bearbeiten** enabled title, description, priority, due date and assignee UUID. Dependencies remained read-only. [Editor screenshot](evidence/g5-task-editable-real-backend.png).
- A real committed 201 response was intentionally dropped; an explicit retry reused the original idempotency key and recovered exactly one immutable new draft. Published task fields and the first task were unchanged before publication. [Draft receipt](evidence/g5-task-draft-saved-real-backend.png).
- **Diesen Entwurf prüfen** opened the exact draft ID/hash. The synthetic test human-role session submitted review, approved and published it. After reload, edited fields, preserved start date, effort, definition of done, other task metadata and dependency edge matched the backend. [Published result](evidence/g5-task-edited-published-real-backend.png).
- A status-only edit on the other test task persisted through reload and was restored. A service approval attempt was denied with 403 (`insufficient_scope`); existing backend tests independently verify a service with approval scope still cannot approve. The backend checks human identity; this test does not claim a real person performed the synthetic fixture approval.
- The owner's G5 demo project and its task, plan, operation, approval and audit rows were compared before and after and were unchanged. The browser blocked all planning/provider requests; the acceptance ledger remained at three calls. [Redacted runtime evidence](evidence/g5-task-editor-runtime.json).

Frontend targeted tests: 22/22; full frontend tests: 95/95; frontend build: PASS. Guard mock-provider regression: 16/16. No new AI request, main merge or production change.

## Manual browser procedure

1. Open `http://localhost:25174` and sign in as an authorized human. Select a project with an existing **published** task, then **Projektaufgaben**. The G5 main demonstration project has no published tasks yet; use a separate appropriate test project for rehearsal.
2. Open the desired task and select **Inhalte bearbeiten**. Edit title, description, priority, due date or a valid project-member UUID in **Verantwortlich**. Dependency checkboxes are deliberately read-only; status changes are separate.
3. Select **Änderungen als Entwurf speichern** once. Read the displayed draft ID and SHA-256. The published task remains unchanged. If a response is lost, keep the identical inputs and explicitly retry; do not start a different edit before checking the outcome.
4. Select **Diesen Entwurf prüfen**. Confirm that the displayed ID and hash equal the receipt, and inspect the task content and other snapshot fields. Select **Review einreichen**. A genuinely authorized human must personally inspect and approve the exact version/hash; do not ask an agent or service to do so.
5. After human approval, select **Plan veröffentlichen**. Return to **Projektaufgaben**, refresh and check the changed task in Kanban and List. Confirm other tasks and dependencies remain as intended. For a status-only change, open a task without entering content-editing mode and use **Status im Backend speichern**.

Do not edit or approve the owner's demonstration data merely to rehearse this procedure. AI planning is not required for task content editing and its separate spending authorization remains unresolved.
