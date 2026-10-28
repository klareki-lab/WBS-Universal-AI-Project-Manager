import type pg from "pg";
import { transaction, type DB } from "./db.js";
import { createPlan, event, lockedProject } from "./domain.js";
import { operationResult } from "./schemas.js";
import { ensure } from "./security.js";
export type Adapter = (job: Record<string, any>) => Promise<unknown>;
export function httpAdapter(endpoint: string, secret: string): Adapter {
  const url = new URL(endpoint);
  ensure(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password,
    500,
    "invalid_adapter_url",
  );
  return async (job) => {
    const r = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        "idempotency-key": job.id,
        "x-request-id": job.id,
      },
      body: JSON.stringify({
        operation_id: job.id,
        project_id: job.project_id,
        conversation_session_id: job.conversation_session_id,
        input: job.input,
        callback_path: `/api/v1/operations/${job.id}/result`,
      }),
    });
    if (!r.ok) throw new Error("Adapter HTTP failure");
    if (r.status === 202) return { accepted: true };
    // Bound automation responses as strictly as inbound HTTP requests.
    const reader = r.body?.getReader();
    ensure(reader, 502, "empty_adapter_response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Adapter response too large");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
}
// Delivery attempts are operational state; terminal/retry changes also enter the
// immutable activity stream. Always lock project before job, as API callbacks do.
async function operationEvent(db: DB, job: Record<string, any>, type: string) {
  await db.query(
    "INSERT INTO activity_events(project_id,actor_id,request_id,type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      job.project_id,
      job.created_by,
      job.id,
      type,
      job.id,
      { source: "worker", attempts: job.attempts },
    ],
  );
}
export async function workOnce(
  pool: pg.Pool,
  adapter: Adapter,
): Promise<boolean> {
  await transaction(pool, async (db) => {
    const expired = await db.query(
      "SELECT * FROM operation_jobs WHERE kind='planning' AND status IN ('queued','running') AND attempts>=max_attempts AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 1",
    );
    if (!expired.rowCount) return;
    const candidate = expired.rows[0];
    await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      candidate.project_id,
    ]);
    const changed = await db.query(
      "UPDATE operation_jobs SET status='failed',error='Retry budget exhausted',lease_until=NULL,updated_at=now() WHERE id=$1 AND status IN ('queued','running') AND attempts>=max_attempts AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
      [candidate.id],
    );
    if (changed.rowCount)
      await operationEvent(db, changed.rows[0], "operation.failed");
  });
  const job = await transaction(pool, async (db) => {
    const r = await db.query(
      "SELECT * FROM operation_jobs WHERE kind='planning' AND attempts<max_attempts AND ((status='queued' AND next_attempt_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!r.rowCount) return null;
    return (
      await db.query(
        "UPDATE operation_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=$1 RETURNING *",
        [r.rows[0].id],
      )
    ).rows[0];
  });
  if (!job) return false;
  try {
    const raw = await adapter(job);
    if (
      raw &&
      typeof raw === "object" &&
      "accepted" in raw &&
      raw.accepted === true
    )
      return true;
    const body = operationResult.parse(raw);
    await transaction(pool, async (db) => {
      const u = await db.query(
        "SELECT id,kind,scopes,disabled FROM users WHERE id=$1",
        [job.created_by],
      );
      ensure(u.rowCount && !u.rows[0].disabled, 403, "creator_disabled");
      const c = { db, actor: u.rows[0], requestId: job.id };
      await lockedProject(c, job.project_id);
      const current = (
        await db.query("SELECT * FROM operation_jobs WHERE id=$1 FOR UPDATE", [
          job.id,
        ])
      ).rows[0];
      if (current.status !== "running" || current.attempts !== job.attempts)
        return;
      const plan = body.result
        ? await createPlan(c, job.project_id, body.result)
        : null;
      await db.query(
        "UPDATE operation_jobs SET status=$2,result=$3,error=$4,lease_until=NULL,updated_at=now() WHERE id=$1",
        [
          job.id,
          plan ? "succeeded" : "failed",
          plan
            ? { plan_version_id: plan.id, content_hash: plan.content_hash }
            : null,
          body.error ? "Automation failed" : null,
        ],
      );
      await event(
        c,
        job.project_id,
        plan ? "operation.succeeded" : "operation.failed",
        job.id,
        { source: "n8n" },
      );
    });
  } catch {
    // Never persist upstream error messages: they may contain secrets or arbitrary model text.
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        job.project_id,
      ]);
      const changed = await db.query(
        "UPDATE operation_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,error='Automation delivery or result validation failed',lease_until=NULL,next_attempt_at=now()+interval '10 seconds'*attempts,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2 RETURNING *",
        [job.id, job.attempts],
      );
      if (changed.rowCount)
        await operationEvent(
          db,
          changed.rows[0],
          changed.rows[0].status === "failed"
            ? "operation.failed"
            : "operation.retry_scheduled",
        );
    });
  }
  return true;
}
export function startWorker(pool: pg.Pool, adapter: Adapter) {
  let stopped = false;
  let pending: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (!stopped && !pending)
      pending = workOnce(pool, adapter)
        .catch(() => {
          console.error("Automation worker poll failed");
        })
        .finally(() => {
          pending = undefined;
        });
  }, 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
