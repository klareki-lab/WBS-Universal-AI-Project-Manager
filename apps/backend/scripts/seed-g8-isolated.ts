import { makePool } from "../src/db.js";
import { passwordHash } from "../src/security.js";
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
try {
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE email='g8-owner@example.test' AND kind='human' AND NOT disabled",
    )
  ).rows[0];
  if (!owner) throw new Error("Synthetic G8 owner missing");
  const company = (
    await pool.query(
      "INSERT INTO companies(name) VALUES('SYNTHETISCH G8') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
    )
  ).rows[0];
  const encoded = await passwordHash("synthetic-g8-employee-password");
  for (const [email, name] of [
    ["g8-person-a@example.test", "SYNTHETISCH Testperson A"],
    ["g8-person-b@example.test", "SYNTHETISCH Testperson B"],
    ["g8-person-c@example.test", "SYNTHETISCH Testperson C"],
  ]) {
    const user =
      (
        await pool.query(
          "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,$2,'human',$3) ON CONFLICT(email) DO NOTHING RETURNING id",
          [email, name, encoded],
        )
      ).rows[0] ??
      (
        await pool.query(
          "SELECT id FROM users WHERE email=$1 AND display_name=$2 AND kind='human'",
          [email, name],
        )
      ).rows[0];
    if (!user) throw new Error("Existing fixture does not match");
    await pool.query(
      "INSERT INTO company_employees(company_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [company.id, user.id],
    );
  }
  await pool.query(
    "INSERT INTO company_employees(company_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [company.id, owner.id],
  );
  console.log("Synthetic G8 company fixtures are ready.");
} finally {
  await pool.end();
}
