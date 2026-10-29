# P1 decision — pending approval revocation (RC v1.1.0)

The original requirements require human approval of an exact immutable version, but do not say whether approval survives loss of the approver's authority. The independent audit correctly labels that question a policy probe, not a proven exploit. This RC makes an explicit **conservative, fail-closed security decision**: an approval authorizes a future publication only while the approver remains eligible and no revocation has been recorded. This decision is published for product-owner review; it is not presented as a pre-existing agreed requirement.

- Disabling a human identity, deleting its project membership, or downgrading owner/editor to viewer permanently revokes that person's **unconsumed** approved plans. PostgreSQL triggers append revocation records in the same identity/membership transaction, including changes made through the trusted administrative CLI or controlled SQL.
- Re-enable/re-add/role restoration does not revive an approval. A new immutable plan version, review and human approval are required. No historical approval row or content hash is changed.
- A current human project owner or the original approving human (while currently authorized to write) may explicitly revoke a pending approval with POST `.../plans/{planId}/revoke-approval`, `{reason}` and an Idempotency-Key. Services cannot revoke or approve. Other editors cannot revoke another person's approval unless they own the project.
- Approval and revocation history is readable through GET `.../plans/{planId}/approvals` by current project readers. The plan's historical `approved` status remains intact after revocation; callers must display the revocation history and handle authoritative publish conflicts, rather than treating that status alone as publish authorization.
- A successfully published plan has consumed its approval. Later account changes do not rewrite history, delete tasks, unpublish the plan or cause duplicate execution. Authorized publication retries return the original successful operation.
- A failed publication transaction does not consume approval. Pending eligibility/revocation checks still apply to a retry.
- Publish locks the project/plan and takes share locks on the approving human and membership. Identity/membership changes serialize with those checks. Publication ordered before revocation may commit; publication ordered after it must fail. Automatic revocation inserts do not take a reverse project lock, avoiding a project→identity versus identity→project deadlock.
- Migration 004 records revocations for already-ineligible pending approvals. Published/superseded history is preserved. Revocation rows themselves are immutable.

This closes P1 under the declared RC policy. Alternative business policies, such as historical approvals surviving account removal, require an explicit product/security decision and a versioned change; they must not silently weaken these checks.

## G3 MVP scope decision — ratification pending

For the G3 acceptance candidate, retain P1 exactly as implemented. Time-based approval expiry is **not a committed MVP requirement**. There is no approval TTL, scheduled expiration, implicit timeout or approval `expires_at`; no schema or migration change is authorized by this scope clarification. The Product Owner must ratify this exclusion before final release acceptance. This records the requested candidate scope, not completed ratification.

These are distinct acceptance cases:

| Case | MVP requirement / evidence |
| --- | --- |
| Revocation when human permissions change | Supported and tested; permanent invalidation of pending approval |
| Explicit human revocation | Supported and tested; immutable revocation history |
| Expired user/session/service credentials | Supported and tested authentication behavior; distinct from approval lifetime |
| Time-based approval expiry | Out of scope for G3 MVP; not implemented and not claimed |

An MCP compatibility label `expired` for a revoked approval means invalidated authority; it is not evidence of a time-based approval TTL.
