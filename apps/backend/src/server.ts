import { makePool } from "./db.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";
import { configuration } from "./config.js";
import { httpAdapter, startWorker } from "./worker.js";
const c = configuration();
const pool = makePool(c.DATABASE_URL);
try {
  await migrate(pool);
  const app = await buildApp({
    pool,
    secureCookies: c.COOKIE_SECURE === "true",
    allowedOrigin: c.ALLOWED_ORIGIN,
    logger: true,
  });
  const stop = c.N8N_ENDPOINT
    ? startWorker(pool, httpAdapter(c.N8N_ENDPOINT, c.N8N_TOKEN))
    : async () => {};
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, async () => {
      if (stopping) return;
      stopping = true;
      try {
        await app.close();
        await stop();
      } finally {
        await pool.end();
      }
    });
  await app.listen({ host: c.HOST, port: c.PORT });
} catch {
  console.error(
    "Backend startup failed; check database connectivity and migration configuration",
  );
  await pool.end();
  process.exitCode = 1;
}
