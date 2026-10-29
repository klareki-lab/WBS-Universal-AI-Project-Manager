# Task editing restored (G4 manual feedback)

Baseline frontend: 5eea6d66455ae9b5243b10d403a7516fb73c3de6.
The owner correctly reported that the G4 live task panel had become read-only.
That restriction was too broad: OpenAPI 1.1.0 already provides taskMetadata.
This fix restores editing in the existing panel, not a second interface.

## User flow

Open a task, choose **Inhalte bearbeiten**, edit title, description, priority,
due date or assignee, then **Änderungen als Entwurf speichern**. The result is
a persisted immutable PlanVersion. The panel displays its real ID/hash and
**Diesen Entwurf prüfen** opens that exact version. Review, explicit human
approval and publication are separate existing actions. The Kanban task
changes only after successful publication. Status-only editing retains its
existing direct PATCH path and version check. No AI call in either workflow.

## Canonical API and preservation

Typed command in src/api/taskChanges.ts uses the documented GET task detail
and PATCH /api/v1/projects/{projectId}/tasks/{taskId}, returning a PlanVersion
(HTTP 201). A preflight read obtains ALL task metadata, including start date,
effort and definition of done that the panel does not display. If its version
differs from the observed panel version, no write is sent. The full canonical
metadata is preserved explicitly, with only user edits overlaid. This avoids
omitted/default fields becoming null/empty in the proposed snapshot. The
server creates dependency closure and validates membership/versions. No new
HTTP endpoint, no direct task-content overwrite, no backend policy change.

The existing shared request client retains cookies, CSRF, read throttling and
sessionStorage idempotency keys. No automatic write retry. A lost response
keeps inputs and allows an explicit identical retry. Success displays the
backend draft receipt, not a claim that a Task was already updated. A 409
keeps the form and its input. New submit is locked while a write is pending.

## Bounded capabilities

The canonical metadata PATCH does not accept dependency edges; this field
remains visibly read-only with an explanation (it is not silently discarded).
An assignee can be supplied as a project-member UUID or cleared. The backend
has no member-directory API in this contract, so this patch does not invent
one or show fictional people. Other existing draft/revision tools are retained.

## Verification and integration

New tests cover editable controls, exact task/version, no local task overwrite,
Unicode/linebreak preservation, preserved metadata, conflicts, null clearing,
no double submission, explicit replay after lost response/429, and demo/live
separation. A real-backend browser scenario edits the SECOND of two tasks,
loses a real 201 response, recovers exactly one draft, reviews/approves its
exact ID/hash, publishes, reloads and checks both persisted tasks and edges.
It also refuses silently selecting a different plan for an unknown query ID.
Screenshots/reports are produced by the existing read-only CI gates. No AI
provider credentials/worker or paid requests are used. Final results are in PR #2.

The integration owner must apply this frontend delta on top of G4 in PR #4.
No integration branch or local service was modified by Astra. PR #4 was read
at 42475b7bdefdc77305b4b4e96091ca8d45ed3431. Preserve its concurrent plan-state
labels/guidance when applying the small LivePlanWorkspace query-selection
change. Do not copy the entire frontend tree over newer integration changes.
The approved source of truth remains Backend/OpenAPI 1.1.0 and P1 approval.

## Owner follow-up: planning screen after saving task changes

A manual task metadata PATCH returns a persisted draft, not a new AI planning job.
The Planning/Review page now places the selected exact plan version and its
human-controlled next action **above** the AI prompt and older operations on
narrow layouts. Historical failed AI jobs remain inspectable in a collapsed
`Backend-Vorgänge` section and cannot be mistaken for a failure of the
persisted manual draft. `Review einreichen` is presented once for the selected
version, with unchanged exact-hash human approval and publication. Direct
status saves are already permanent and do not require a planning/review step.
No API/contract or security policy change and no paid AI request.
