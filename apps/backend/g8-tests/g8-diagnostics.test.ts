import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makePool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import {
  collect,
  membershipPreflight,
  classifyError,
  isSafeLocalUrl,
} from "../scripts/g8-diagnostics.js";
const url = process.env.G8_ISOLATED_DATABASE_URL;
if (!url) throw new Error("G8_ISOLATED_DATABASE_URL required");
const parsed = new URL(url);
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "35467" ||
  parsed.pathname !== "/uapm_g8_test"
)
  throw new Error("Refusing non-G8 database");
const pool = makePool(url);
const owner = randomUUID(),
  projectA = randomUUID(),
  draft = randomUUID(),
  helpdesk = randomUUID(),
  company = randomUUID();
const roster = Array.from({ length: 14 }, () => randomUUID());
beforeAll(async () => {
  await migrate(pool);
  await pool.query(
    "INSERT INTO users(id,email,display_name,kind,password_hash) VALUES($1,$2,'PRIVATE-TEST-SENTINEL','human','test-only')",
    [owner, owner + "@example.test"],
  );
  await pool.query(
    "INSERT INTO projects(id,owner_id,name) VALUES($1,$3,'PRIVATE-TEST-SENTINEL'),($2,$3,'PRIVATE-TEST-SENTINEL')",
    [projectA, helpdesk, owner],
  );
  const snapshot = {
    phases: [{ key: "p", name: "PRIVATE-TEST-SENTINEL" }],
    tasks: [],
  };
  await pool.query(
    "INSERT INTO plan_versions(id,project_id,number,base_project_version,snapshot,content_hash,created_by) VALUES($1,$2,2,1,$3,$4,$5)",
    [draft, projectA, snapshot, "a".repeat(64), owner],
  );
  await pool.query(
    "INSERT INTO operation_jobs(project_id,created_by,kind,status,input,error,created_at,updated_at) VALUES($1,$2,'planning','failed',$3,'PRIVATE-TEST-SENTINEL','2026-10-29T13:29:00Z','2026-10-29T13:29:30Z')",
    [helpdesk, owner, { prompt: "PRIVATE-TEST-SENTINEL" }],
  );
  await pool.query("INSERT INTO companies(id,name) VALUES($1,$2)", [
    company,
    "SYNTHETIC " + company,
  ]);
  for (const id of roster)
    await pool.query(
      "INSERT INTO users(id,email,display_name,kind,password_hash) VALUES($1,$2,'PRIVATE-TEST-SENTINEL','human','test-only')",
      [id, id + "@example.test"],
    );
  await pool.query(
    "INSERT INTO company_employees(company_id,user_id) VALUES($1,$2)",
    [company, roster[0]],
  );
  const otherCompany = randomUUID();
  await pool.query("INSERT INTO companies(id,name) VALUES($1,$2)", [
    otherCompany,
    "SYNTHETIC OTHER " + otherCompany,
  ]);
  await pool.query(
    "INSERT INTO company_employees(company_id,user_id) VALUES($1,$2)",
    [otherCompany, roster[1]],
  );
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [roster[2]]);
});
afterAll(async () => {
  await pool.end();
});
describe("redacted owner-side read-only diagnostics", () => {
  it("rejects remote hosts, host overrides and unconfirmed database names", () => {
    expect(
      isSafeLocalUrl(
        "postgresql://127.0.0.1:35467/uapm_g8_test",
        "uapm_g8_test",
      ),
    ).toBe(true);
    expect(
      isSafeLocalUrl(
        "postgresql://127.0.0.1/uapm_g8_test?host=remote.example",
        "uapm_g8_test",
      ),
    ).toBe(false);
    expect(
      isSafeLocalUrl(
        "postgresql://remote.example/uapm_g8_test",
        "uapm_g8_test",
      ),
    ).toBe(false);
    expect(isSafeLocalUrl("postgresql://127.0.0.1/other", "uapm_g8_test")).toBe(
      false,
    );
  });
  it("exports only permitted evidence, classifies only known errors, and cannot write in the read-only transaction", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const report = await collect(db, helpdesk, projectA, draft);
      expect(report.incident_a.selected_plan_found).toBe(true);
      expect(report.incident_b.operations).toHaveLength(1);
      expect(report.incident_b.operations[0].error_classification).toBe(
        "UNCLASSIFIED",
      );
      expect(JSON.stringify(report)).not.toContain("PRIVATE-TEST-SENTINEL");
      expect(JSON.stringify(report)).not.toContain(owner);
      expect(classifyError("AI_BUDGET_EXHAUSTED")).toBe("AI_BUDGET_EXHAUSTED");
      await expect(
        db.query("DELETE FROM projects WHERE id=$1", [projectA]),
      ).rejects.toMatchObject({ code: "25006" });
      await db.query("ROLLBACK");
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
    }
  });
  it("reports exact roster indexes without exposing identities and refuses audit approval by inference", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN READ ONLY");
      const result = await membershipPreflight(db, {
        companyId: company,
        userIds: roster,
      });
      expect(result.schema_ready).toBe(true);
      expect(result.ready_to_associate).toBe(false);
      expect(result.accounts?.filter((a) => a.already_target)).toHaveLength(1);
      expect(result.accounts?.[1].other_companies).toBe(1);
      expect(result.accounts?.[2].active_human).toBe(false);
      expect(result.pair_unique).toBe(true);
      expect(JSON.stringify(result)).not.toContain(roster[0]);
      await expect(
        membershipPreflight(db, {
          companyId: company,
          userIds: roster.slice(1),
        }),
      ).rejects.toThrow();
      await db.query("ROLLBACK");
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
    }
  });
});
