import type { DB } from "./db.js";
import type { Actor } from "./security.js";
import { access, contentHash, ensure, HttpError } from "./security.js";
import { validateSnapshot, type Snapshot } from "./schemas.js";
export type Context = { db: DB; actor: Actor; requestId: string };
export async function event(
  c: Context,
  project: string,
  type: string,
  id: string,
  data: unknown = {},
) {
  await c.db.query(
    "INSERT INTO activity_events(project_id,actor_id,request_id,type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [project, c.actor.id, c.requestId, type, id, data],
  );
}
export async function lockedProject(c: Context, id: string) {
  await access(c.db, c.actor, id, true);
  return (
    await c.db.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
}
export async function createPlan(
  c: Context,
  project: string,
  input: { base_project_version: number; snapshot: Snapshot },
  reason?: string,
  originOperationId?: string,
) {
  const p = await lockedProject(c, project);
  ensure(p.status !== "archived", 409, "project_archived");
  ensure(
    p.version === input.base_project_version,
    409,
    "stale_project_version",
  );
  try {
    validateSnapshot(input.snapshot);
  } catch (e) {
    throw new HttpError(400, "invalid_plan", (e as Error).message);
  }
  for (const t of input.snapshot.tasks) {
    if (t.assignee_id)
      ensure(
        (
          await c.db.query(
            "SELECT 1 FROM project_members m JOIN users u ON m.user_id=u.id WHERE m.project_id=$1 AND m.user_id=$2 AND u.kind='human' AND NOT u.disabled",
            [project, t.assignee_id],
          )
        ).rowCount,
        400,
        "invalid_assignee",
      );
    if (t.task_id) {
      const r = await c.db.query(
        "SELECT version FROM tasks WHERE project_id=$1 AND id=$2",
        [project, t.task_id],
      );
      ensure(r.rowCount, 400, "invalid_task_reference");
      ensure(
        r.rows[0].version === t.expected_version,
        409,
        "stale_task_version",
      );
    }
  }
  const n = (
    await c.db.query(
      "SELECT COALESCE(max(number),0)+1 AS n FROM plan_versions WHERE project_id=$1",
      [project],
    )
  ).rows[0].n;
  const plan = (
    await c.db.query(
      "INSERT INTO plan_versions(project_id,number,base_project_version,snapshot,content_hash,created_by,origin_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        project,
        n,
        p.version,
        input.snapshot,
        contentHash(input.snapshot),
        c.actor.id,
        originOperationId ?? null,
      ],
    )
  ).rows[0];
  for (const t of input.snapshot.tasks)
    await c.db.query(
      "INSERT INTO plan_task_drafts(project_id,plan_version_id,key,data) VALUES($1,$2,$3,$4)",
      [project, plan.id, t.key, t],
    );
  if (reason)
    await c.db.query(
      "INSERT INTO change_proposals(project_id,plan_version_id,reason,created_by) VALUES($1,$2,$3,$4)",
      [project, plan.id, reason, c.actor.id],
    );
  await event(
    c,
    project,
    reason ? "change_proposal.created" : "plan.created",
    plan.id,
    { content_hash: plan.content_hash },
  );
  return plan;
}
export async function getPlan(
  c: Context,
  project: string,
  id: string,
  lock = false,
) {
  const r = await c.db.query(
    `SELECT * FROM plan_versions WHERE project_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [project, id],
  );
  ensure(r.rowCount, 404, "plan_not_found");
  return r.rows[0];
}
export async function review(c: Context, project: string, id: string) {
  await lockedProject(c, project);
  const plan = await getPlan(c, project, id, true);
  ensure(plan.status === "draft", 409, "invalid_plan_state");
  const r = await c.db.query(
    "UPDATE plan_versions SET status='in_review' WHERE id=$1 RETURNING *",
    [id],
  );
  await event(c, project, "plan.review_requested", id);
  return r.rows[0];
}
export async function approve(
  c: Context,
  project: string,
  id: string,
  input: { content_hash: string; decision: string; comment: string },
) {
  ensure(c.actor.kind === "human", 403, "human_approval_required");
  await lockedProject(c, project);
  const plan = await getPlan(c, project, id, true);
  ensure(plan.status === "in_review", 409, "invalid_plan_state");
  ensure(
    plan.content_hash === input.content_hash &&
      contentHash(plan.snapshot) === input.content_hash,
    409,
    "content_hash_mismatch",
  );
  const r = await c.db.query(
    "INSERT INTO approvals(project_id,plan_version_id,user_id,content_hash,decision,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [
      project,
      id,
      c.actor.id,
      input.content_hash,
      input.decision,
      input.comment,
    ],
  );
  await c.db.query("UPDATE plan_versions SET status=$1 WHERE id=$2", [
    input.decision,
    id,
  ]);
  await event(c, project, "plan." + input.decision, id, {
    approval_id: r.rows[0].id,
    content_hash: input.content_hash,
  });
  return r.rows[0];
}
export async function publish(
  c: Context,
  project: string,
  id: string,
  expectedHash: string,
) {
  const p = await lockedProject(c, project);
  const plan = await getPlan(c, project, id, true);
  ensure(
    plan.content_hash === expectedHash &&
      contentHash(plan.snapshot) === expectedHash,
    409,
    "content_hash_mismatch",
  );
  const previous = await c.db.query(
    "SELECT * FROM operation_jobs WHERE project_id=$1 AND kind='publish' AND status='succeeded' AND input->>'plan_version_id'=$2 ORDER BY created_at LIMIT 1",
    [project, id],
  );
  if (previous.rowCount) return previous.rows[0];
  ensure(plan.status === "approved", 409, "approval_required");
  ensure(p.status !== "archived", 409, "project_archived");
  ensure(p.version === plan.base_project_version, 409, "stale_project_version");
  const approval = (
    await c.db.query(
      "SELECT * FROM approvals WHERE plan_version_id=$1 AND content_hash=$2 AND decision='approved'",
      [id, expectedHash],
    )
  ).rows[0];
  ensure(approval, 409, "approval_required");
  const approver = (
    await c.db.query("SELECT * FROM users WHERE id=$1 FOR SHARE", [
      approval.user_id,
    ])
  ).rows[0];
  const membership = (
    await c.db.query(
      "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE",
      [project, approval.user_id],
    )
  ).rows[0];
  ensure(
    approver?.kind === "human" &&
      !approver.disabled &&
      membership &&
      membership.role !== "viewer",
    409,
    "approver_no_longer_authorized",
  );
  ensure(
    !(
      await c.db.query(
        "SELECT 1 FROM approval_revocations WHERE approval_id=$1",
        [approval.id],
      )
    ).rowCount,
    409,
    "approval_revoked",
  );
  const s = plan.snapshot as Snapshot;
  validateSnapshot(s);
  const phases = new Map<string, string>();
  for (const [i, phase] of s.phases.entries()) {
    const r = await c.db.query(
      "INSERT INTO phases(project_id,key,name,description,position) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,position=EXCLUDED.position RETURNING id",
      [project, phase.key, phase.name, phase.description, i],
    );
    phases.set(phase.key, r.rows[0].id);
  }
  const ids = new Map<string, string>();
  for (const t of s.tasks) {
    const values = [
      project,
      phases.get(t.phase_key),
      t.title,
      t.description,
      t.priority,
      t.assignee_id,
      t.start_date,
      t.due_date,
      t.estimated_effort,
      t.definition_of_done,
      id,
      t.key,
    ];
    if (t.task_id) {
      const r = await c.db.query(
        "UPDATE tasks SET phase_id=$2,title=$3,description=$4,priority=$5,assignee_id=$6,start_date=$7,due_date=$8,estimated_effort=$9,definition_of_done=$10,source_plan_id=$11,source_key=$12,version=version+1,updated_at=now() WHERE project_id=$1 AND id=$13 AND version=$14 RETURNING id",
        [...values, t.task_id, t.expected_version],
      );
      ensure(r.rowCount, 409, "stale_task_version");
      ids.set(t.key, t.task_id);
    } else {
      const r = await c.db.query(
        "INSERT INTO tasks(project_id,phase_id,title,description,priority,assignee_id,start_date,due_date,estimated_effort,definition_of_done,source_plan_id,source_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
        values,
      );
      ids.set(t.key, r.rows[0].id);
    }
  }
  for (const t of s.tasks) {
    await c.db.query(
      "DELETE FROM task_dependencies WHERE project_id=$1 AND task_id=$2",
      [project, ids.get(t.key)],
    );
    for (const dep of t.depends_on)
      await c.db.query(
        "INSERT INTO task_dependencies(project_id,task_id,depends_on_id) VALUES($1,$2,$3)",
        [project, ids.get(t.key), ids.get(dep)],
      );
  }
  // Validate the entire resulting graph in linear time, including retained tasks.
  const edges = (
    await c.db.query(
      "SELECT task_id,depends_on_id FROM task_dependencies WHERE project_id=$1",
      [project],
    )
  ).rows;
  const degree = new Map<string, number>(),
    outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    degree.set(edge.task_id, (degree.get(edge.task_id) ?? 0) + 1);
    if (!degree.has(edge.depends_on_id)) degree.set(edge.depends_on_id, 0);
    const list = outgoing.get(edge.depends_on_id) ?? [];
    list.push(edge.task_id);
    outgoing.set(edge.depends_on_id, list);
  }
  const ready = [...degree].filter(([, n]) => n === 0).map(([id]) => id);
  let processed = 0;
  for (let i = 0; i < ready.length; i++) {
    processed++;
    for (const next of outgoing.get(ready[i]) ?? []) {
      const remaining = degree.get(next)! - 1;
      degree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  ensure(processed === degree.size, 409, "dependency_cycle");
  ensure(
    !(
      await c.db.query(
        "SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.task_id JOIN tasks predecessor ON predecessor.id=d.depends_on_id WHERE d.project_id=$1 AND t.status IN ('in_progress','done') AND predecessor.status<>'done' LIMIT 1",
        [project],
      )
    ).rowCount,
    409,
    "dependencies_incomplete",
  );
  if (p.published_plan_id)
    await c.db.query(
      "UPDATE plan_versions SET status='superseded' WHERE id=$1 AND status='published'",
      [p.published_plan_id],
    );
  await c.db.query(
    "UPDATE plan_versions SET status='published',published_at=now() WHERE id=$1",
    [id],
  );
  await c.db.query(
    "UPDATE projects SET published_plan_id=$2,version=version+1,status=CASE WHEN status='draft' THEN 'active' ELSE status END,updated_at=now() WHERE id=$1",
    [project, id],
  );
  const job = (
    await c.db.query(
      "INSERT INTO operation_jobs(project_id,created_by,kind,status,input,result,attempts) VALUES($1,$2,'publish','succeeded',$3,$4,1) RETURNING *",
      [
        project,
        c.actor.id,
        { plan_version_id: id },
        {
          plan_version_id: id,
          task_ids: Object.fromEntries(ids),
          task_count: ids.size,
        },
      ],
    )
  ).rows[0];
  await event(c, project, "plan.published", id, {
    operation_id: job.id,
    task_count: ids.size,
  });
  return job;
}
const transitions: Record<string, string[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "blocked", "done", "cancelled"],
  blocked: ["todo", "in_progress", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};
export async function updateStatus(
  c: Context,
  project: string,
  id: string,
  input: { version: number; status: string },
) {
  const p = await lockedProject(c, project);
  ensure(p.status !== "archived", 409, "project_archived");
  const r = await c.db.query(
    "SELECT * FROM tasks WHERE project_id=$1 AND id=$2 FOR UPDATE",
    [project, id],
  );
  ensure(r.rowCount, 404, "task_not_found");
  const t = r.rows[0];
  ensure(t.version === input.version, 409, "stale_task_version");
  ensure(
    t.status === input.status || transitions[t.status].includes(input.status),
    409,
    "invalid_status_transition",
  );
  if (t.status === input.status) return t;
  if (["in_progress", "done"].includes(input.status))
    ensure(
      !(
        await c.db.query(
          "SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_id WHERE d.task_id=$1 AND t.status<>'done' LIMIT 1",
          [id],
        )
      ).rowCount,
      409,
      "dependencies_incomplete",
    );
  if (t.status === "done")
    ensure(
      !(
        await c.db.query(
          "SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE d.depends_on_id=$1 AND t.status IN ('in_progress','done') LIMIT 1",
          [id],
        )
      ).rowCount,
      409,
      "active_dependents",
    );
  const updated = (
    await c.db.query(
      "UPDATE tasks SET status=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *",
      [input.status, id],
    )
  ).rows[0];
  await c.db.query(
    "UPDATE projects SET version=version+1,updated_at=now() WHERE id=$1",
    [project],
  );
  await event(c, project, "task.status_changed", id, {
    from: t.status,
    to: input.status,
    version: updated.version,
  });
  return updated;
}

export function operationContextHash(job: Record<string, any>) {
  return contentHash({
    id: job.id,
    project_id: job.project_id,
    created_by: job.created_by,
    input: job.input,
    conversation_session_id: job.conversation_session_id,
    request_id: job.request_id,
  });
}
export async function validatePlanningContext(
  c: Context,
  job: Record<string, any>,
  result?: { base_project_version: number },
) {
  ensure(
    job.kind === "planning" &&
      job.context_hash &&
      operationContextHash(job) === job.context_hash,
    409,
    "operation_context_mismatch",
  );
  const project = (
    await c.db.query("SELECT version,status FROM projects WHERE id=$1", [
      job.project_id,
    ])
  ).rows[0];
  ensure(project.status !== "archived", 409, "project_archived");
  ensure(
    project.version === job.input.base_project_version &&
      (!result ||
        result.base_project_version === job.input.base_project_version),
    409,
    "stale_operation",
  );
  const user = (
    await c.db.query(
      "SELECT id,kind,disabled,scopes,token_expires_at FROM users WHERE id=$1 FOR SHARE",
      [job.created_by],
    )
  ).rows[0];
  const member = (
    await c.db.query(
      "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE",
      [job.project_id, job.created_by],
    )
  ).rows[0];
  ensure(
    user &&
      !user.disabled &&
      member &&
      member.role !== "viewer" &&
      (user.kind === "human" ||
        (user.scopes.includes("operations:write") &&
          user.token_expires_at > new Date())),
    409,
    "originating_authorization_revoked",
  );
}
export async function revokeApproval(
  c: Context,
  project: string,
  id: string,
  reason: string,
) {
  const p = await lockedProject(c, project);
  const plan = await getPlan(c, project, id, true);
  ensure(plan.status === "approved", 409, "approval_not_pending");
  const approval = (
    await c.db.query(
      "SELECT * FROM approvals WHERE plan_version_id=$1 AND decision='approved'",
      [id],
    )
  ).rows[0];
  ensure(approval, 409, "approval_required");
  ensure(
    p.owner_id === c.actor.id || approval.user_id === c.actor.id,
    403,
    "revocation_not_permitted",
  );
  const r = await c.db.query(
    "INSERT INTO approval_revocations(approval_id,actor_id,reason,source,request_id) VALUES($1,$2,$3,'human',$4) ON CONFLICT(approval_id) DO NOTHING RETURNING *",
    [approval.id, c.actor.id, reason, c.requestId],
  );
  if (!r.rowCount)
    return (
      await c.db.query(
        "SELECT * FROM approval_revocations WHERE approval_id=$1",
        [approval.id],
      )
    ).rows[0];
  await event(c, project, "approval.revoked", approval.id, {
    revocation_id: r.rows[0].id,
  });
  return r.rows[0];
}
