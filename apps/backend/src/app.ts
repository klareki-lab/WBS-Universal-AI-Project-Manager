import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { transaction, isConnectionError, type DB } from "./db.js";
import {
  hash,
  csrfToken,
  token,
  passwordMatches,
  passwordHash,
  contentHash,
  HttpError,
  ensure,
  access,
  scope,
  type Actor,
} from "./security.js";
import * as s from "./schemas.js";
import * as d from "./domain.js";
import { specs } from "./api-contract.js";
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (x) => x);
export type Config = {
  pool: pg.Pool;
  secureCookies: boolean;
  allowedOrigin: string;
  logger?: boolean;
  automationServiceId?: string;
};
export async function buildApp(config: Config) {
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30000,
    genReqId: () => randomUUID(),
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: 60000 });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id).header("cache-control", "no-store");
    const origin = req.headers.origin;
    if (origin) {
      ensure(origin === config.allowedOrigin, 403, "origin_denied");
      reply
        .header("access-control-allow-origin", origin)
        .header("access-control-allow-credentials", "true")
        .header("vary", "Origin")
        .header("access-control-expose-headers", "x-request-id");
    }
    if (req.method === "OPTIONS") {
      reply
        .header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS")
        .header(
          "access-control-allow-headers",
          "content-type,x-csrf-token,idempotency-key,authorization",
        );
      return reply.code(204).send();
    }
  });
  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { code?: string; statusCode?: number };
    const status = isConnectionError(e)
      ? 503
      : e instanceof z.ZodError
        ? 400
        : (e.statusCode ??
          (e.code === "23505"
            ? 409
            : e.code === "23503" ||
                e.code === "23514" ||
                e.code === "22021" ||
                e.code === "22P05"
              ? 400
              : 500));
    if (status >= 500) req.log.error({ err: e }, "Request failed");
    reply.code(status).send({
      error: {
        code: isConnectionError(e)
          ? "database_unavailable"
          : e instanceof z.ZodError || ["22021", "22P05"].includes(e.code ?? "")
            ? "invalid_input"
            : status >= 500
              ? "internal_error"
              : (e.code ?? "request_error"),
        message: isConnectionError(e)
          ? "Database temporarily unavailable; retry the same idempotency key"
          : status >= 500
            ? "Internal server error"
            : e instanceof z.ZodError ||
                ["22021", "22P05"].includes(e.code ?? "")
              ? "Input validation failed"
              : e.message,
        request_id: req.id,
      },
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: req.id,
      },
    }),
  );
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    try {
      await config.pool
        .query(
          "SELECT 1 FROM schema_migrations WHERE name='004_approval_revocations.sql'",
        )
        .then((r) => ensure(r.rowCount, 503, "not_migrated"));
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  async function authenticate(
    req: FastifyRequest,
    write = false,
    executor: Pick<pg.Pool, "query"> = config.pool,
    lock = false,
  ): Promise<Actor> {
    const authorization = req.headers.authorization;
    if (authorization) {
      ensure(
        /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization),
        401,
        "invalid_token",
      );
      const r = await executor.query(
        "SELECT id,kind,scopes FROM users WHERE token_hash=$1 AND kind='service' AND NOT disabled AND token_expires_at>now()" +
          (lock ? " FOR SHARE" : ""),
        [hash(authorization.slice(7))],
      );
      ensure(r.rowCount, 401, "invalid_token");
      return r.rows[0];
    }
    const session = req.cookies.uapm_session;
    ensure(session, 401, "authentication_required");
    const r = await executor.query(
      "SELECT u.id,u.kind,u.scopes,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled AND u.kind='human'" +
        (lock ? " FOR SHARE OF u,s" : ""),
      [hash(session)],
    );
    ensure(r.rowCount, 401, "session_expired");
    if (write) {
      const csrf = req.headers["x-csrf-token"];
      ensure(
        typeof csrf === "string" && hash(csrf) === r.rows[0].csrf_hash,
        403,
        "csrf_required",
      );
    }
    return r.rows[0];
  }
  const dummy = await passwordHash(token());
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (req, reply) => {
      const input = s.login.parse(req.body);
      const r = await config.pool.query(
        "SELECT * FROM users WHERE email=$1 AND kind='human' AND NOT disabled",
        [input.email.toLowerCase()],
      );
      const valid = await passwordMatches(
        input.password,
        r.rows[0]?.password_hash ?? dummy,
      );
      ensure(valid && r.rowCount, 401, "invalid_credentials");
      const session = token(),
        csrf = csrfToken(session);
      const expiry = new Date(Date.now() + 8 * 3600 * 1000);
      await config.pool.query(
        "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)",
        [hash(session), r.rows[0].id, hash(csrf), expiry],
      );
      reply.setCookie("uapm_session", session, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
      return {
        user: s.userResponse.parse(r.rows[0]),
        csrf_token: csrf,
        expires_at: expiry.toISOString(),
      };
    },
  );
  app.post("/api/v1/auth/logout", async (req, reply) => {
    const actor = await authenticate(req, true);
    ensure(
      actor.kind === "human" && req.cookies.uapm_session,
      403,
      "human_session_required",
    );
    await config.pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies.uapm_session!),
    ]);
    return reply
      .clearCookie("uapm_session", {
        path: "/",
        secure: config.secureCookies,
        sameSite: "strict",
        httpOnly: true,
      })
      .code(204)
      .send();
  });
  for (const path of ["/api/v1/auth/me", "/api/v1/auth/session"])
    app.get(path, async (req) => {
      const a = await authenticate(req);
      const r = await config.pool.query(
        "SELECT id,email,display_name,kind,scopes FROM users WHERE id=$1",
        [a.id],
      );
      return s.userResponse.parse(r.rows[0]);
    });
  app.get("/api/v1/auth/csrf", async (req) => {
    const actor = await authenticate(req);
    ensure(
      actor.kind === "human" && req.cookies.uapm_session,
      403,
      "human_session_required",
    );
    const csrf = csrfToken(req.cookies.uapm_session!);
    const updated = await config.pool.query(
      "UPDATE sessions SET csrf_hash=$2 WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
      [hash(req.cookies.uapm_session!), hash(csrf)],
    );
    ensure(updated.rowCount, 401, "session_expired");
    return { csrf_token: csrf };
  });
  function page(rows: unknown[], q: any) {
    return { items: rows, limit: q.limit, offset: q.offset };
  }
  const handlers: Record<
    string,
    (c: d.Context, p: any, b: any, q: any) => Promise<unknown>
  > = {
    createProject: async (c, _p, b) => {
      const r = await c.db.query(
        "INSERT INTO projects(owner_id,name,description) VALUES($1,$2,$3) RETURNING *",
        [c.actor.id, b.name, b.description],
      );
      const p = r.rows[0];
      await c.db.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'owner')",
        [p.id, c.actor.id],
      );
      if (config.automationServiceId) {
        const service = await c.db.query(
          "SELECT id FROM users WHERE id=$1 AND kind='service' AND NOT disabled AND token_expires_at>now() AND scopes @> ARRAY['read','plans:write','operations:write']::text[] FOR SHARE",
          [config.automationServiceId],
        );
        ensure(service.rowCount, 503, "automation_unavailable");
        await c.db.query(
          "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
          [p.id, config.automationServiceId],
        );
        await d.event(
          c,
          p.id,
          "automation.member_assigned",
          config.automationServiceId,
        );
      }
      await d.event(c, p.id, "project.created", p.id);
      return p;
    },
    listProjects: async (c, _p, _b, q) =>
      page(
        (
          await c.db.query(
            "SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=$1 ORDER BY p.created_at DESC,p.id LIMIT $2 OFFSET $3",
            [c.actor.id, q.limit, q.offset],
          )
        ).rows,
        q,
      ),
    getProject: async (c, p) => {
      const { role, ...project } = await access(c.db, c.actor, p.projectId);
      return project;
    },
    updateProject: async (c, p, b) => {
      const project = await d.lockedProject(c, p.projectId);
      ensure(project.version === b.version, 409, "stale_project_version");
      const r = await c.db.query(
        "UPDATE projects SET name=$2,description=$3,status=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          p.projectId,
          b.name ?? project.name,
          b.description ?? project.description,
          b.status ?? project.status,
        ],
      );
      await d.event(c, p.projectId, "project.updated", p.projectId, {
        version: r.rows[0].version,
      });
      return r.rows[0];
    },
    dashboard: async (c, p) => {
      const { role, ...project } = await access(c.db, c.actor, p.projectId);
      const phases = (
        await c.db.query(
          "SELECT * FROM phases WHERE project_id=$1 ORDER BY position,id",
          [p.projectId],
        )
      ).rows;
      const counts = (
        await c.db.query(
          "SELECT status,count(*)::int AS count FROM tasks WHERE project_id=$1 GROUP BY status",
          [p.projectId],
        )
      ).rows;
      const by_status = Object.fromEntries(
        s.taskStatus.options.map((k) => [k, 0]),
      );
      for (const x of counts) by_status[x.status] = x.count;
      const total = counts.reduce((n, x) => n + x.count, 0);
      return {
        project,
        phases,
        total,
        by_status,
        progress_percent: total
          ? Math.round((100 * by_status.done) / total)
          : 0,
      };
    },
    listTasks: async (c, p, _b, q) =>
      page(
        (
          await c.db.query(
            "SELECT * FROM tasks WHERE project_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR phase_id=$3) AND ($4::uuid IS NULL OR assignee_id=$4) AND ($5::text IS NULL OR strpos(lower(title),lower($5))>0 OR strpos(lower(description),lower($5))>0) ORDER BY created_at,id LIMIT $6 OFFSET $7",
            [
              p.projectId,
              q.status ?? null,
              q.phase_id ?? null,
              q.assignee_id ?? null,
              q.q ?? null,
              q.limit,
              q.offset,
            ],
          )
        ).rows,
        q,
      ),
    getTask: async (c, p) => {
      const r = await c.db.query(
        "SELECT * FROM tasks WHERE project_id=$1 AND id=$2",
        [p.projectId, p.taskId],
      );
      ensure(r.rowCount, 404, "task_not_found");
      return r.rows[0];
    },
    taskStatus: async (c, p, b) => d.updateStatus(c, p.projectId, p.taskId, b),
    taskMetadata: async (c, p, b) => {
      const project = await d.lockedProject(c, p.projectId);
      const task = (await handlers.getTask(c, p, null, null)) as any;
      ensure(task.version === b.version, 409, "stale_task_version");
      // Include dependency closure so existing predecessor edges cannot be lost by a metadata proposal.
      const all = (
        await c.db.query(
          "SELECT t.*,p.key AS phase_key,p.name AS phase_name,p.description AS phase_description FROM tasks t JOIN phases p ON p.id=t.phase_id WHERE t.project_id=$1 ORDER BY t.id",
          [p.projectId],
        )
      ).rows;
      const edges = (
        await c.db.query(
          "SELECT * FROM task_dependencies WHERE project_id=$1",
          [p.projectId],
        )
      ).rows;
      const phases = Array.from(
        new Map(
          all.map((t) => [
            t.phase_key,
            {
              key: t.phase_key,
              name: t.phase_name,
              description: t.phase_description,
            },
          ]),
        ).values(),
      );
      const tasks = all.map((t) => ({
        key: t.id,
        phase_key: t.phase_key,
        task_id: t.id,
        expected_version: t.version,
        ...Object.fromEntries(Object.keys(s.taskFields).map((k) => [k, t[k]])),
        ...(t.id === task.id
          ? Object.fromEntries(
              Object.entries(b).filter(([k]) => k !== "version"),
            )
          : {}),
        depends_on: edges
          .filter((e) => e.task_id === t.id)
          .map((e) => e.depends_on_id),
      }));
      return d.createPlan(
        c,
        p.projectId,
        s.planCreate.parse({
          base_project_version: project.version,
          snapshot: { phases, tasks },
        }),
        "Task metadata update",
      );
    },
    dependencies: async (c, p) => {
      await handlers.getTask(c, p, null, null);
      return {
        items: (
          await c.db.query(
            "SELECT * FROM task_dependencies WHERE project_id=$1 AND task_id=$2",
            [p.projectId, p.taskId],
          )
        ).rows,
      };
    },
    createPlan: async (c, p, b) => d.createPlan(c, p.projectId, b),
    listPlans: async (c, p, _b, q) =>
      page(
        (
          await c.db.query(
            "SELECT * FROM plan_versions WHERE project_id=$1 ORDER BY number DESC LIMIT $2 OFFSET $3",
            [p.projectId, q.limit, q.offset],
          )
        ).rows,
        q,
      ),
    getPlan: async (c, p) => d.getPlan(c, p.projectId, p.planId),
    proposeChanges: async (c, p, b) =>
      d.createPlan(c, p.projectId, b, b.reason),
    submitReview: async (c, p) => d.review(c, p.projectId, p.planId),
    requestApproval: async (c, p) => {
      await d.lockedProject(c, p.projectId);
      const plan = await d.getPlan(c, p.projectId, p.planId, true);
      if (plan.status === "draft") return d.review(c, p.projectId, p.planId);
      ensure(plan.status === "in_review", 409, "invalid_plan_state");
      await d.event(c, p.projectId, "plan.approval_requested", plan.id);
      return plan;
    },
    decidePlan: async (c, p, b) => d.approve(c, p.projectId, p.planId, b),
    publishPlan: async (c, p, b) =>
      d.publish(c, p.projectId, p.planId, b.content_hash),
    listOperations: async (c, p, _b, q) =>
      page(
        (
          await c.db.query(
            "SELECT * FROM operation_jobs WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
            [p.projectId, q.limit, q.offset],
          )
        ).rows,
        q,
      ),
    getOperation: async (c, p) => {
      const r = await c.db.query("SELECT * FROM operation_jobs WHERE id=$1", [
        p.operationId,
      ]);
      ensure(r.rowCount, 404, "operation_not_found");
      await access(c.db, c.actor, r.rows[0].project_id);
      return r.rows[0];
    },
    audit: async (c, p, _b, q) =>
      page(
        (
          await c.db.query(
            "SELECT * FROM activity_events WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
            [p.projectId, q.limit, q.offset],
          )
        ).rows,
        q,
      ),
    planningRequest: async (c, p, b) => {
      const project = await d.lockedProject(c, p.projectId);
      ensure(project.status !== "archived", 409, "project_archived");
      if (b.conversation_session_id)
        ensure(
          (
            await c.db.query(
              "SELECT 1 FROM conversation_sessions WHERE project_id=$1 AND id=$2",
              [p.projectId, b.conversation_session_id],
            )
          ).rowCount,
          400,
          "invalid_conversation",
        );
      const operationId = randomUUID();
      const r = await c.db.query(
        "INSERT INTO operation_jobs(project_id,created_by,kind,status,input,conversation_session_id,request_id,context_hash,id) VALUES($1,$2,'planning','queued',$3,$4,$5,$6,$7) RETURNING *",
        [
          p.projectId,
          c.actor.id,
          { ...b, base_project_version: project.version },
          b.conversation_session_id ?? null,
          c.requestId,
          d.operationContextHash({
            id: operationId,
            project_id: p.projectId,
            created_by: c.actor.id,
            input: { ...b, base_project_version: project.version },
            conversation_session_id: b.conversation_session_id ?? null,
            request_id: c.requestId,
          }),
          operationId,
        ],
      );
      await d.event(c, p.projectId, "operation.queued", r.rows[0].id);
      return r.rows[0];
    },
    operationResult: async (c, p, b) => {
      ensure(c.actor.kind === "service", 403, "service_required");
      scope(c.actor, "plans:write");
      const op = (await handlers.getOperation(c, p, null, null)) as any;
      await d.lockedProject(c, op.project_id);
      const job = (
        await c.db.query(
          "SELECT * FROM operation_jobs WHERE id=$1 FOR UPDATE",
          [p.operationId],
        )
      ).rows[0];
      ensure(job.kind === "planning", 409, "invalid_operation_kind");
      ensure(
        ["queued", "running"].includes(job.status),
        409,
        "operation_terminal",
      );
      await d.validatePlanningContext(c, job, b.result);
      const result = b.result
        ? await d.createPlan(c, job.project_id, b.result, undefined, job.id)
        : null;
      const r = await c.db.query(
        "UPDATE operation_jobs SET status=$2,result=$3,error=$4,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *",
        [
          job.id,
          result ? "succeeded" : "failed",
          result
            ? { plan_version_id: result.id, content_hash: result.content_hash }
            : null,
          b.error ? "Automation failed" : null,
        ],
      );
      await d.event(c, job.project_id, "operation." + r.rows[0].status, job.id);
      return r.rows[0];
    },
    approvalHistory: async (c, p) => {
      await d.getPlan(c, p.projectId, p.planId);
      return {
        items: (
          await c.db.query(
            "SELECT * FROM approvals WHERE project_id=$1 AND plan_version_id=$2 ORDER BY created_at,id",
            [p.projectId, p.planId],
          )
        ).rows,
        revocations: (
          await c.db.query(
            "SELECT r.* FROM approval_revocations r JOIN approvals a ON a.id=r.approval_id WHERE a.project_id=$1 AND a.plan_version_id=$2 ORDER BY r.created_at,r.id",
            [p.projectId, p.planId],
          )
        ).rows,
      };
    },
    revokeApproval: async (c, p, b) =>
      d.revokeApproval(c, p.projectId, p.planId, b.reason),
    conversation: async (c, p, b) => {
      const r = await c.db.query(
        "INSERT INTO conversation_sessions(project_id,provider,external_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,provider,external_id) DO UPDATE SET external_id=EXCLUDED.external_id RETURNING *",
        [p.projectId, b.provider, b.external_id, c.actor.id],
      );
      await d.event(c, p.projectId, "conversation.correlated", r.rows[0].id);
      return r.rows[0];
    },
  };
  for (const [name, spec] of Object.entries(specs))
    app.route({
      method: spec.method,
      url: spec.url,
      handler: async (req, reply) => {
        const write = spec.method !== "GET",
          actor = await authenticate(req, write);
        scope(actor, spec.scope);
        for (const extra of spec.additionalScopes ?? []) scope(actor, extra);
        if (spec.serviceOnly)
          ensure(actor.kind === "service", 403, "service_required");
        if (spec.human) ensure(actor.kind === "human", 403, "human_required");
        const params = Object.fromEntries(
          Object.entries(req.params as Record<string, string>).map(([k, v]) => [
            k,
            s.uuid.parse(v),
          ]),
        );
        const body = spec.body ? spec.body.parse(req.body) : undefined;
        if (!spec.body && write)
          ensure(
            req.body === undefined || req.body === null,
            400,
            "unexpected_body",
          );
        const query = spec.query
          ? spec.query.parse(req.query)
          : z.strictObject({}).parse(req.query);
        const key = write
          ? z
              .string()
              .min(8)
              .max(200)
              .regex(/^[A-Za-z0-9_.:-]+$/)
              .parse(req.headers["idempotency-key"])
          : undefined;
        const requestHash = contentHash({
          method: spec.method,
          path: req.url,
          body: body ?? null,
        });
        const result = await transaction(config.pool, async (db) => {
          const currentActor = await authenticate(req, write, db, true);
          scope(currentActor, spec.scope);
          for (const extra of spec.additionalScopes ?? [])
            scope(currentActor, extra);
          const c = { db, actor: currentActor, requestId: req.id };
          if (params.projectId)
            await access(db, actor, params.projectId, write);
          if (params.operationId) {
            const r = await db.query(
              "SELECT project_id FROM operation_jobs WHERE id=$1",
              [params.operationId],
            );
            ensure(r.rowCount, 404, "operation_not_found");
            await access(db, actor, r.rows[0].project_id, write);
          }
          if (key) {
            await db.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [actor.id + ":" + key],
            );
            const old = await db.query(
              "SELECT * FROM idempotency_records WHERE actor_id=$1 AND key=$2",
              [actor.id, key],
            );
            if (old.rowCount) {
              ensure(
                old.rows[0].request_hash === requestHash,
                409,
                "idempotency_key_reused",
              );
              ensure(
                old.rows[0].resource_project_id,
                409,
                "idempotency_context_missing",
              );
              await access(
                db,
                currentActor,
                old.rows[0].resource_project_id,
                true,
              );
              return {
                status: old.rows[0].status_code,
                body: old.rows[0].response,
              };
            }
          }
          const output = await handlers[name](c, params, body, query);
          const checked = spec.response.safeParse(
            JSON.parse(JSON.stringify(output)),
          );
          if (!checked.success) {
            req.log.error({ issues: checked.error.issues }, "Invalid response");
            throw new HttpError(500, "invalid_response");
          }
          const response = checked.data;
          const status = spec.status ?? 200;
          if (key)
            await db.query(
              "INSERT INTO idempotency_records(actor_id,key,request_hash,response,status_code,resource_project_id) VALUES($1,$2,$3,$4,$5,$6)",
              [
                actor.id,
                key,
                requestHash,
                response,
                status,
                params.projectId ??
                  (response as any).project_id ??
                  (response as any).id,
              ],
            );
          return { status, body: response };
        });
        return reply.code(result.status).send(result.body);
      },
    });
  return app;
}
