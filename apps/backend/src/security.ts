import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { DB } from "./db.js";
const scrypt = (
  password: string,
  salt: string,
  length: number,
  options: import("node:crypto").ScryptOptions,
) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export const token = () => randomBytes(32).toString("base64url");
export const hash = (x: string) => createHash("sha256").update(x).digest("hex");
export const csrfToken = (session: string) => hash("uapm-csrf-v1:" + session);
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export const contentHash = (x: unknown) => hash(canonical(x));
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [, salt, key] = encoded.split("$");
  if (!salt || !key) return false;
  const actual = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  status = 409,
  code = "conflict",
): asserts value {
  if (!value) throw new HttpError(status, code);
}
export type Actor = { id: string; kind: "human" | "service"; scopes: string[] };
export async function access(
  db: DB,
  actor: Actor,
  projectId: string,
  write = false,
) {
  const r = await db.query(
    "SELECT p.*,m.role FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=$1 AND m.user_id=$2 FOR SHARE OF m",
    [projectId, actor.id],
  );
  ensure(r.rowCount, 404, "project_not_found");
  ensure(!write || r.rows[0].role !== "viewer", 403, "read_only");
  return r.rows[0];
}
export function scope(actor: Actor, required: string) {
  ensure(
    actor.kind === "human" || actor.scopes.includes(required),
    403,
    "insufficient_scope",
  );
}
