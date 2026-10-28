import { makePool } from "./db.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";
import { configuration } from "./config.js";
import { httpAdapter, startWorker } from "./worker.js";
const c = configuration();
const pool = makePool(c.DATABASE_URL);
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
for (const sig of ["SIGINT", "SIGTERM"])
  process.once(sig, async () => {
    await app.close();
    await stop();
    await pool.end();
  });
await app.listen({ host: c.HOST, port: c.PORT });
