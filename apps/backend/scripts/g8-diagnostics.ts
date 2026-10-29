/** Owner-side diagnostics: fixed SELECTs in a read-only transaction; never invokes services. */
import pg from "pg";
import { randomBytes, createHmac } from "node:crypto";
import { realpath, stat, mkdtemp, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const draftId = "6c00a5d5-0c1f-43d0-b841-c40df2e7fedb";
const projectA = "8c21ac99-b09a-41dd-bfa9-8f81e97f1be9";
const allowedEvents = new Set([
  "plan.created",
  "plan.review_requested",
  "plan.submitted",
  "plan.approved",
  "plan.rejected",
  "plan.published",
  "approval.revoked",
  "operation.queued",
  "operation.running",
  "operation.succeeded",
  "operation.failed",
  "operation.retry_scheduled",
  "project.member_added",
  "member.added",
  "member.role_changed",
  "member.removed",
]);
const errorCodes: Record<string, string> = {
  AI_BUDGET_EXHAUSTED: "AI_BUDGET_EXHAUSTED",
  AI_CONCURRENCY_LIMIT: "AI_CONCURRENCY_LIMIT",
  AI_PLANNING_FAILED: "AI_PLANNING_FAILED",
  "Retry budget exhausted": "RETRY_BUDGET_EXHAUSTED",
  "Automation delivery or result validation failed":
    "DELIVERY_OR_RESULT_VALIDATION_FAILED",
  "Automation failed": "AUTOMATION_FAILED",
  originating_authorization_revoked: "ORIGINATING_AUTHORIZATION_REVOKED",
};
export function classifyError(value: unknown) {
  return typeof value === "string"
    ? Object.hasOwn(errorCodes, value)
      ? errorCodes[value]
      : "UNCLASSIFIED"
    : value === null
      ? "NONE"
      : "UNCLASSIFIED";
}
function eventType(value: unknown) {
  return typeof value === "string" && allowedEvents.has(value)
    ? value
    : "other";
}
const safeStatus = (value: unknown, valid: readonly string[]) =>
  typeof value === "string" && valid.includes(value) ? value : "other";
export async function collect(
  db: pg.PoolClient,
  helpdeskProjectId: string,
  selectedProjectId = projectA,
  selectedDraftId = draftId,
) {
  if (
    !uuid.test(selectedProjectId) ||
    !uuid.test(selectedDraftId) ||
    !uuid.test(helpdeskProjectId)
  )
    throw new Error("Invalid synthetic helpdesk project identity");
  const key = randomBytes(32);
  const pseudonym = (x: string) =>
    createHmac("sha256", key).update(x).digest("hex").slice(0, 16);
  const project = (
    await db.query(
      "SELECT version,published_plan_id FROM projects WHERE id=$1",
      [selectedProjectId],
    )
  ).rows[0];
  const plans = (
    await db.query(
      "SELECT id,number,status,created_at,published_at,base_project_version,jsonb_array_length(snapshot->'tasks') AS task_count FROM plan_versions WHERE project_id=$1 ORDER BY number,id",
      [selectedProjectId],
    )
  ).rows;
  const chosen = plans.find((row) => row.id === selectedDraftId);
  const approvals = (
    await db.query(
      "SELECT a.decision,a.created_at,(a.content_hash=p.content_hash) AS hash_matches_plan FROM approvals a JOIN plan_versions p ON p.id=a.plan_version_id WHERE a.project_id=$1 AND a.plan_version_id=$2 ORDER BY a.created_at,a.id",
      [selectedProjectId, selectedDraftId],
    )
  ).rows;
  const hasRevocations = (
    await db.query(
      "SELECT to_regclass('public.approval_revocations') IS NOT NULL AS present",
    )
  ).rows[0].present;
  const revocations = hasRevocations
    ? (
        await db.query(
          "SELECT r.source,r.created_at FROM approval_revocations r JOIN approvals a ON a.id=r.approval_id WHERE a.project_id=$1 AND a.plan_version_id=$2 ORDER BY r.created_at,r.id",
          [selectedProjectId, selectedDraftId],
        )
      ).rows
    : [];
  const tasks = (
    await db.query(
      `SELECT t.id,t.version,t.assignee_id IS NOT NULL AS assigned,t.source_plan_id=$2 AS sourced_from_selected_plan,
 t.assignee_id::text IS NOT DISTINCT FROM item->>'assignee_id' AS matches_selected_assignment,t.updated_at
 FROM tasks t JOIN plan_versions p ON p.id=$2 AND p.project_id=$1
 JOIN LATERAL jsonb_array_elements(p.snapshot->'tasks') item ON item->>'task_id'=t.id::text WHERE t.project_id=$1 ORDER BY t.id`,
      [selectedProjectId, selectedDraftId],
    )
  ).rows;
  const events = (
    await db.query(
      `SELECT type,created_at FROM activity_events WHERE project_id=$1 AND (entity_id=$2 OR entity_id IN
 (SELECT id FROM approvals WHERE project_id=$1 AND plan_version_id=$2) OR entity_id IN
 (SELECT id FROM operation_jobs WHERE project_id=$1 AND kind='publish' AND (input->>'plan_version_id'=$2::text OR result->>'plan_version_id'=$2::text))) ORDER BY created_at,id`,
      [selectedProjectId, selectedDraftId],
    )
  ).rows;
  const operations = (
    await db.query(
      `SELECT id,kind,status,error,attempts,max_attempts,created_at,updated_at FROM operation_jobs WHERE project_id=$1 AND (created_at >= ('2026-10-29 14:27:00'::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ('2026-10-29 14:31:00'::timestamp AT TIME ZONE 'Europe/Berlin') OR updated_at >= ('2026-10-29 14:27:00'::timestamp AT TIME ZONE 'Europe/Berlin') AND updated_at < ('2026-10-29 14:31:00'::timestamp AT TIME ZONE 'Europe/Berlin')) ORDER BY created_at,id`,
      [helpdeskProjectId],
    )
  ).rows;
  const opEvents = (
    await db.query(
      `SELECT e.entity_id,e.type,e.created_at FROM activity_events e WHERE e.project_id=$1 AND e.entity_id IN (SELECT id FROM operation_jobs WHERE project_id=$1 AND (created_at >= ('2026-10-29 14:27:00'::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ('2026-10-29 14:31:00'::timestamp AT TIME ZONE 'Europe/Berlin') OR updated_at >= ('2026-10-29 14:27:00'::timestamp AT TIME ZONE 'Europe/Berlin') AND updated_at < ('2026-10-29 14:31:00'::timestamp AT TIME ZONE 'Europe/Berlin'))) ORDER BY e.created_at,e.id`,
      [helpdeskProjectId],
    )
  ).rows;
  return {
    format: "g8-sanitized-diagnostics-v1",
    generated_at: new Date().toISOString(),
    interpretation:
      "Evidence only. A current task assignment cannot prove when a name was displayed in a browser.",
    incident_a: {
      project_found: Boolean(project),
      project_version: project?.version ?? null,
      selected_plan_found: Boolean(chosen),
      selected_plan_task_count: chosen?.task_count ?? null,
      matched_task_count: tasks.length,
      revocation_table_present: hasRevocations,
      revocations: revocations.map((row) => ({
        source: safeStatus(row.source, [
          "human",
          "identity_disabled",
          "membership_removed",
          "role_downgraded",
          "upgrade",
        ]),
        created_at: row.created_at,
      })),
      published_plan_number:
        plans.find((row) => row.id === project?.published_plan_id)?.number ??
        null,
      plans: plans.map((row) => ({
        number: row.number,
        status: safeStatus(row.status, [
          "draft",
          "in_review",
          "approved",
          "published",
          "superseded",
          "rejected",
        ]),
        created_at: row.created_at,
        published_at: row.published_at,
        base_project_version: row.base_project_version,
        selected: row.id === selectedDraftId,
      })),
      approvals: approvals.map((row) => ({
        decision: safeStatus(row.decision, ["approved", "rejected"]),
        created_at: row.created_at,
        hash_matches_plan: row.hash_matches_plan,
      })),
      matched_published_tasks: tasks.map((row) => ({
        task_ref: pseudonym(row.id),
        version: row.version,
        assigned: row.assigned,
        sourced_from_selected_plan: row.sourced_from_selected_plan,
        matches_selected_assignment: row.matches_selected_assignment,
        updated_at: row.updated_at,
      })),
      audit: events.map((row) => ({
        type: eventType(row.type),
        created_at: row.created_at,
      })),
    },
    incident_b: {
      window: "2026-10-29 14:27–14:31 Europe/Berlin",
      operations: operations.map((row) => ({
        operation_ref: pseudonym(row.id),
        kind: safeStatus(row.kind, ["planning", "publish"]),
        status: safeStatus(row.status, [
          "queued",
          "running",
          "succeeded",
          "failed",
        ]),
        error_classification: classifyError(row.error),
        attempts: row.attempts,
        max_attempts: row.max_attempts,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      audit: opEvents.map((row) => ({
        operation_ref: pseudonym(row.entity_id),
        type: eventType(row.type),
        created_at: row.created_at,
      })),
    },
  };
}
type Manifest = { companyId: string; userIds: string[] };
export async function membershipPreflight(
  db: pg.PoolClient,
  manifest: Manifest,
) {
  if (
    !manifest ||
    !uuid.test(manifest.companyId) ||
    !Array.isArray(manifest.userIds) ||
    manifest.userIds.length !== 14 ||
    manifest.userIds.some((id) => typeof id !== "string" || !uuid.test(id)) ||
    new Set(manifest.userIds.map((id) => id.toLowerCase())).size !== 14
  )
    throw new Error(
      "Manifest must contain a company ID and 14 distinct account IDs",
    );
  const schema = (
    await db.query(
      "SELECT to_regclass('public.companies') IS NOT NULL AS companies, to_regclass('public.company_employees') IS NOT NULL AS employees",
    )
  ).rows[0];
  if (!schema.companies || !schema.employees)
    return {
      schema_ready: false,
      ready_to_associate: false,
      blocker: "COMPANY_SCHEMA_MISSING",
    };
  const company = await db.query("SELECT 1 FROM companies WHERE id=$1", [
    manifest.companyId,
  ]);
  const people = (
    await db.query(
      "SELECT id,kind,disabled FROM users WHERE id=ANY($1::uuid[])",
      [manifest.userIds],
    )
  ).rows;
  const links = (
    await db.query(
      "SELECT user_id,company_id=$2::uuid AS target FROM company_employees WHERE user_id=ANY($1::uuid[])",
      [manifest.userIds, manifest.companyId],
    )
  ).rows;
  const projectRoles = (
    await db.query(
      "SELECT user_id,role,count(*)::int AS count FROM project_members WHERE user_id=ANY($1::uuid[]) GROUP BY user_id,role",
      [manifest.userIds],
    )
  ).rows;
  const indexes = manifest.userIds.map((id, index) => {
    const person = people.find((row) => row.id === id.toLowerCase());
    const rows = links.filter((row) => row.user_id === id.toLowerCase());
    return {
      input_index: index + 1,
      exists: Boolean(person),
      active_human: Boolean(
        person && person.kind === "human" && !person.disabled,
      ),
      already_target: rows.some((row) => row.target),
      other_companies: rows.filter((row) => !row.target).length,
      project_roles: Object.fromEntries(
        ["owner", "editor", "viewer"].map((role) => [
          role,
          projectRoles.find(
            (row) => row.user_id === id.toLowerCase() && row.role === role,
          )?.count ?? 0,
        ]),
      ),
    };
  });
  const metadata = (
    await db.query(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.company_employees'::regclass AND contype IN ('p','u') AND pg_get_constraintdef(oid) IN ('PRIMARY KEY (company_id, user_id)','UNIQUE (company_id, user_id)')) AS pair_unique,
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='public.company_employees'::regclass AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype & 4)<>0) AS enabled_insert_triggers`)
  ).rows[0];
  return {
    schema_ready: true,
    target_company_id: manifest.companyId,
    company_found: company.rowCount === 1,
    roster_count: 14,
    accounts: indexes,
    pair_unique: metadata.pair_unique,
    enabled_insert_triggers: metadata.enabled_insert_triggers,
    audit_policy_verified: false,
    ready_to_associate: false,
    blocker: "AUDIT_POLICY_AND_EXACT_ROSTER_REQUIRE_OWNER_REVIEW",
  };
}
export function isSafeLocalUrl(value: string, expectedDb: string) {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      /^[a-zA-Z0-9_]+$/.test(expectedDb) &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" + expectedDb
    );
  } catch {
    return false;
  }
}
export async function main() {
  const databaseUrl = process.env.G8_DIAGNOSTICS_DATABASE_URL,
    helpdesk = process.env.G8_HELPDESK_PROJECT_ID,
    expectedDb = process.env.G8_EXPECTED_DATABASE_NAME,
    baseDir = process.env.G8_DIAGNOSTICS_PARENT,
    manifestPath = process.env.G8_MEMBERSHIP_MANIFEST;
  if (
    !databaseUrl ||
    !helpdesk ||
    !expectedDb ||
    !baseDir ||
    process.env.G8_CONFIRM_LOCAL_ISOLATED !== "YES"
  )
    throw new Error("Required owner-side environment is missing");
  if (!isSafeLocalUrl(databaseUrl, expectedDb))
    throw new Error(
      "Only the explicitly named local isolated database is permitted",
    );
  const parent = await realpath(baseDir);
  const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const ignored = path.join(repo, ".g3");
  if (parent !== ignored && !parent.startsWith(ignored + path.sep))
    throw new Error("Output must be under the ignored local .g3 directory");
  const metadata = await stat(parent);
  if (
    !metadata.isDirectory() ||
    (process.getuid && metadata.uid !== process.getuid()) ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error("Output parent must be owner-only");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "g8-read-only-diagnostics",
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  try {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await db.query("SET LOCAL statement_timeout = '10s'");
      const current = (await db.query("SELECT current_database() AS name"))
        .rows[0].name;
      if (current !== expectedDb) throw new Error("Database identity mismatch");
      const report = await collect(db, helpdesk);
      if (manifestPath) {
        const resolved = await realpath(manifestPath);
        if (!resolved.startsWith(ignored + path.sep))
          throw new Error("Manifest must be under .g3");
        const fileInfo = await stat(resolved);
        if (
          !fileInfo.isFile() ||
          (process.getuid && fileInfo.uid !== process.getuid()) ||
          (fileInfo.mode & 0o077) !== 0 ||
          fileInfo.size > 8192
        )
          throw new Error("Manifest must be an owner-only regular file");
        const manifest = JSON.parse(
          await readFile(resolved, "utf8"),
        ) as Manifest;
        Object.assign(report, {
          membership_preflight: await membershipPreflight(db, manifest),
        });
      }
      await db.query("COMMIT");
      const output = await mkdtemp(path.join(parent, "g8-incident-"));
      const file = await open(
        path.join(output, "diagnostics.json"),
        "wx",
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify(report, null, 2) + "\n");
      } finally {
        await file.close();
      }
      process.stdout.write(
        "Sanitized diagnostics written to " +
          path.join(output, "diagnostics.json") +
          "\n",
      );
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  } finally {
    await pool.end();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    process.stderr.write(
      "Diagnostics failed safely. Verify owner-supplied local database identity, read privileges and output-directory permissions.\n",
    );
    process.exitCode = 1;
  });
