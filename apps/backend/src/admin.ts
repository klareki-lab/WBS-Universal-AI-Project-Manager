import { z } from "zod";
import { makePool, transaction } from "./db.js";
import { passwordHash, token, hash, ensure } from "./security.js";
const pool = makePool(z.url().parse(process.env.DATABASE_URL));
try {
  const command = process.argv[2];
  if (command === "create-user") {
    const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase(),
      password = z.string().min(12).max(1024).parse(process.env.ADMIN_PASSWORD),
      name = z.string().min(1).max(200).parse(process.env.ADMIN_NAME);
    const r = await pool.query(
      "INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,$2,'human',$3) RETURNING id,email",
      [email, name, await passwordHash(password)],
    );
    console.log(JSON.stringify(r.rows[0]));
  } else if (command === "create-service") {
    const name = z
        .string()
        .regex(/^[a-z0-9_-]{1,60}$/)
        .parse(process.env.SERVICE_NAME),
      project = z.uuid().parse(process.env.SERVICE_PROJECT_ID);
    const scopes = z
      .array(
        z.enum(["read", "plans:write", "operations:write", "plans:publish"]),
      )
      .min(1)
      .parse(process.env.SERVICE_SCOPES?.split(","));
    const secret = token();
    const result = await transaction(pool, async (db) => {
      ensure(
        (await db.query("SELECT 1 FROM projects WHERE id=$1", [project]))
          .rowCount,
        404,
        "project_not_found",
      );
      const r = await db.query(
        "INSERT INTO users(email,display_name,kind,token_hash,scopes,token_expires_at) VALUES($1,$2,'service',$3,$4,now()+interval '90 days') RETURNING id",
        [name + "@service.invalid", name, hash(secret), scopes],
      );
      await db.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",
        [project, r.rows[0].id],
      );
      return r.rows[0];
    });
    console.log(
      JSON.stringify({ ...result, token: secret, expires_in_days: 90 }),
    );
  } else if (command === "disable-user") {
    const id = z.uuid().parse(process.env.USER_ID);
    await transaction(pool, async (db) => {
      await db.query("UPDATE users SET disabled=true WHERE id=$1", [id]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
    });
    console.log("Identity disabled");
  } else
    throw new Error(
      "Usage: npm run admin -- create-user|create-service|disable-user",
    );
} finally {
  await pool.end();
}
