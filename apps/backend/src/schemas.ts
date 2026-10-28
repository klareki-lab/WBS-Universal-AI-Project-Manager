import { z } from "zod";
export const uuid = z.uuid();
export const taskStatus = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);
export const projectStatus = z.enum([
  "draft",
  "active",
  "on_hold",
  "completed",
  "archived",
]);
export const planStatus = z.enum([
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
  "rejected",
]);
const text = z.string().trim().min(1).max(200);
const longText = z.string().max(20000);
const date = z.iso.date().nullable().default(null);
const version = z.number().int().positive();
export const projectCreate = z.strictObject({
  name: text,
  description: longText.default(""),
});
export const projectUpdate = z.strictObject({
  version,
  name: text.optional(),
  description: longText.optional(),
  status: projectStatus.optional(),
});
export const taskFields = {
  title: text,
  description: longText.default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignee_id: uuid.nullable().default(null),
  start_date: date,
  due_date: date,
  estimated_effort: z
    .number()
    .nonnegative()
    .max(100000)
    .nullable()
    .default(null),
  definition_of_done: longText.default(""),
};
export const taskDraft = z
  .strictObject({
    key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    phase_key: text,
    task_id: uuid.optional(),
    expected_version: version.optional(),
    ...taskFields,
    depends_on: z.array(z.string().min(1).max(80)).max(500).default([]),
  })
  .refine(
    (x) => !x.start_date || !x.due_date || x.start_date <= x.due_date,
    "start_date must not follow due_date",
  )
  .refine(
    (x) => Boolean(x.task_id) === Boolean(x.expected_version),
    "task_id and expected_version must appear together",
  );
export const snapshot = z.strictObject({
  phases: z
    .array(
      z.strictObject({
        key: text,
        name: text,
        description: longText.default(""),
      }),
    )
    .min(1)
    .max(50),
  tasks: z.array(taskDraft).min(1).max(500),
});
export const planCreate = z.strictObject({
  base_project_version: version,
  snapshot,
});
export const proposalCreate = planCreate.extend({ reason: text });
export const versionInput = z.strictObject({ version });
export const decision = z.strictObject({
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approved", "rejected"]),
  comment: longText.default(""),
});
export const hashInput = z.strictObject({
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const statusUpdate = z.strictObject({ version, status: taskStatus });
export const metadataUpdate = z.strictObject({
  version,
  ...Object.fromEntries(
    Object.entries(taskFields).map(([k, v]) => [k, v.optional()]),
  ),
});
export const planningRequest = z.strictObject({
  prompt: z.string().trim().min(1).max(20000),
  conversation_session_id: uuid.optional(),
});
export const conversationCreate = z.strictObject({
  provider: text,
  external_id: text,
});
export const operationResult = z
  .strictObject({
    result: planCreate.optional(),
    error: z.string().max(2000).optional(),
  })
  .refine(
    (x) => Boolean(x.result) !== Boolean(x.error),
    "Provide result or error",
  );
export const login = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});
export const listQuery = z.strictObject({
  status: taskStatus.optional(),
  phase_id: uuid.optional(),
  assignee_id: uuid.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type Snapshot = z.infer<typeof snapshot>;
export function validateSnapshot(s: Snapshot) {
  const phases = new Set(s.phases.map((x) => x.key));
  const tasks = new Map(s.tasks.map((x) => [x.key, x]));
  if (phases.size !== s.phases.length || tasks.size !== s.tasks.length)
    throw new Error("Duplicate phase/task keys");
  const ids = s.tasks.flatMap((x) => (x.task_id ? [x.task_id] : []));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate task_id");
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(k: string) {
    if (visiting.has(k)) throw new Error("Dependency cycle");
    if (done.has(k)) return;
    const t = tasks.get(k);
    if (!t) throw new Error("Unknown dependency");
    visiting.add(k);
    if (!phases.has(t.phase_key)) throw new Error("Unknown phase");
    if (new Set(t.depends_on).size !== t.depends_on.length)
      throw new Error("Duplicate dependency");
    t.depends_on.forEach(visit);
    visiting.delete(k);
    done.add(k);
  }
  tasks.forEach((_, k) => visit(k));
}
// Response schemas also generate OpenAPI, JSON Schema, and frontend/MCP types.
const ts = z.iso.datetime({ offset: true });
const nullableTs = ts.nullable();
export const userResponse = z.object({
  id: uuid,
  email: z.string(),
  display_name: z.string(),
  kind: z.enum(["human", "service"]),
  scopes: z.array(z.string()),
});
export const projectResponse = z.object({
  id: uuid,
  owner_id: uuid,
  name: z.string(),
  description: z.string(),
  status: projectStatus,
  version,
  published_plan_id: uuid.nullable(),
  created_at: ts,
  updated_at: ts,
});
export const phaseResponse = z.object({
  id: uuid,
  project_id: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  position: z.number().int(),
});
export const taskResponse = z.object({
  id: uuid,
  project_id: uuid,
  phase_id: uuid,
  ...taskFields,
  status: taskStatus,
  version,
  source_plan_id: uuid,
  source_key: z.string(),
  created_at: ts,
  updated_at: ts,
});
export const planResponse = z.object({
  id: uuid,
  project_id: uuid,
  number: version,
  base_project_version: version,
  status: planStatus,
  snapshot,
  content_hash: z.string(),
  created_by: uuid,
  created_at: ts,
  published_at: nullableTs,
});
export const approvalResponse = z.object({
  id: uuid,
  project_id: uuid,
  plan_version_id: uuid,
  user_id: uuid,
  content_hash: z.string(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string(),
  created_at: ts,
});
export const operationResponse = z.object({
  id: uuid,
  project_id: uuid,
  created_by: uuid,
  kind: z.enum(["planning", "publish"]),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  next_attempt_at: ts,
  lease_until: nullableTs,
  conversation_session_id: uuid.nullable(),
  created_at: ts,
  updated_at: ts,
});
export const conversationResponse = z.object({
  id: uuid,
  project_id: uuid,
  provider: z.string(),
  external_id: z.string(),
  created_by: uuid,
  created_at: ts,
});
export const eventResponse = z.object({
  id: uuid,
  project_id: uuid,
  actor_id: uuid,
  request_id: z.string(),
  type: z.string(),
  entity_id: uuid,
  data: z.record(z.string(), z.unknown()),
  created_at: ts,
});
export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
});
export const collection = (item: z.ZodType) =>
  z.object({
    items: z.array(item),
    limit: z.number().int(),
    offset: z.number().int(),
  });
