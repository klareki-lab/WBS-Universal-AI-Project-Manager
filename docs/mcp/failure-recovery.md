# Failure recovery and resilience

## Timeouts

- Default outbound request timeout: `UAPM_REQUEST_TIMEOUT_MS` (10s).
- Each request is cancellable via `AbortController`.
- A timed-out write MUST NOT be retried blindly. Call
  `get_operation_status` with the idempotency key or operation ID before
  issuing a new attempt. "Timed out" ≠ "failed".

## Retries

- Backend retries: `UAPM_MAX_RETRIES` (default 2) with exponential backoff
  on `429`, `502`, `503`, `504`, and `AbortError`.
- `Retry-After` is honoured when present.
- MCP tool-level retries are **not** performed for mutations with unknown
  outcome; the client is expected to inspect operation status first.

## Idempotency

- Required for every mutation.
- Key must be unique per logical operation.
- If a tool returns `idempotency_conflict`, the client MUST NOT retry
  with the same key; it must either look up the existing operation or
  issue a fresh operation with a new key once state is understood.

## 429 handling

- Returned as `{ error: { code: "rate_limited", ... } }`.
- Clients should back off, honour `retry-after`, and not escalate to a
  more expensive model.

## Partial failures

- `publish_approved_plan` is atomic in the backend contract: either all
  tasks are materialized or none. The MCP server does not perform partial
  publication.
- `update_task` on multiple fields is atomic.
- If one of several HTTP read calls fails, the WF-04 workflow surfaces the
  error without claiming success.

## Correlation IDs

- Clients should supply `x-correlation-id` for every request.
- The server propagates it to backend calls and includes it in structured
  JSON logs so a single conversation / workflow can be reconstructed.

## Safe recovery after interrupted writes

Procedure for an operator reviewing a stuck mutation:

1. Fetch the operation by stored key: `get_operation_status(operationId)`.
2. If `state === "succeeded"`, treat the write as completed; do not retry.
3. If `state === "failed"`, inspect `lastError` and decide whether to
   issue a new operation with a **fresh** idempotency key.
4. If `state === "in_progress"` or the operation is missing but the key
   is already consumed, wait or escalate — never silently retry.
