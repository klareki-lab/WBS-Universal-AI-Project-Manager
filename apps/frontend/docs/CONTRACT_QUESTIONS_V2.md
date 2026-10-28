# Contract decisions awaiting Architecture / Backend Lead

1. **Operational vs planned fields:** which properties does plan approval publish to live tasks? How are divergent due dates and deletion handled without overwriting user work?
2. **Concurrency:** row versions, ETag or conditional writes? How are stale draft IDs and task conflicts surfaced?
3. **Approval roles:** who can approve, reject, request revision and publish? Is multi-approver workflow required?
4. **Approval transaction:** is publish atomic with approval record? What happens if task projection fails halfway?
5. **Immutable snapshots:** digest/hash semantics; are status changes external metadata? Plan retention policy?
6. **Task lifecycle:** new tasks without phase, cross-project dependencies, dependency cycles, completed/blocked transition guards and delete/archive behavior?
7. **Members:** where do project membership and assignee IDs originate? Backend-controlled permissions and teams?
8. **AI proposal schema:** versioned schema for patch actions, affected records, dry-run impact, risk and conflict explanations?
9. **Agent history:** streaming/SSE, cancellation, resumability, side effects and source citations? Is a conversation itself persistent?
10. **Operation jobs:** safe retry semantics, idempotency keys, authorization, partial success handling, event delivery and cancellation?
11. **Project health:** authoritative health/progress calculation, deadline timezones, overdue status, budgets and milestones?
12. **API transport:** exact route map, auth/session cookies, CSRF, error envelope, pagination, filtering, polling and correlation IDs?
13. **Localizations:** DE/EN/RU message catalogs, server error localization, dates/numbers/timezones, accessibility review.
14. **Optional connectors:** whether and when an integration can write into or merely export native tasks; never as source of truth.

Do not implement production routes or authorization assumptions until these are signed off.
