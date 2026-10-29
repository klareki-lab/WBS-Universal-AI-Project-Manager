import { makePool } from "./db.js";
import { configuration } from "./config.js";
import { httpAdapter, startWorker } from "./worker.js";
const c = configuration();
if (!c.N8N_ENDPOINT) throw new Error("N8N_ENDPOINT required");
const pool = makePool(c.DATABASE_URL);
const stop = startWorker(pool, httpAdapter(c.N8N_ENDPOINT, c.N8N_TOKEN));
const keepAlive = setInterval(() => {}, 60000);
for (const s of ["SIGINT", "SIGTERM"])
  process.once(s, async () => {
    clearInterval(keepAlive);
    await stop();
    await pool.end();
  });
