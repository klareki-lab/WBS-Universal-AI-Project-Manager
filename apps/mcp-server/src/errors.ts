export type BackendErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "approval_required"
  | "stale_version"
  | "idempotency_conflict"
  | "rate_limited"
  | "backend_unavailable"
  | "timeout"
  | "internal_error";

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: BackendErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toToolErrorPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
      },
    };
  }
}

export function errorToToolPayload(err: unknown): { error: { code: string; message: string } } {
  if (err instanceof BackendError) {
    return { error: { code: err.code, message: err.message } };
  }
  if (err instanceof Error) {
    return { error: { code: "internal_error", message: err.message } };
  }
  return { error: { code: "internal_error", message: "Unknown error" } };
}
