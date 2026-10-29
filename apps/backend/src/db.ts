import pg from "pg";
const connectionFailures = new WeakMap<pg.PoolClient, Error>();
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return (
    code.startsWith("08") ||
    [
      "57P01",
      "57P02",
      "57P03",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ].includes(code) ||
    /connection terminated|connection error|connection timeout|timeout exceeded when trying to connect|query read timeout/i.test(
      error.message,
    )
  );
}
function report(event: string, error: unknown) {
  // Error messages can include connection strings or SQL. Log only stable codes.
  console.error(
    JSON.stringify({
      event,
      code: (error as NodeJS.ErrnoException)?.code ?? "connection_lost",
    }),
  );
}
export const makePool = (url: string) => {
  const pool = new pg.Pool({
    connectionString: url,
    application_name: "uapm-backend",
    max: 10,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 18000,
  });
  pool.on("connect", (client) => {
    // A checked-out client can emit an error with no query callback pending.
    client.on("error", (error) => {
      connectionFailures.set(client, error);
      report("postgres.client_error", error);
    });
  });
  // pg discards idle failed clients. An event listener is mandatory to avoid a
  // process-level uncaught error; future requests acquire fresh connections.
  pool.on("error", (error) => report("postgres.idle_error", error));
  return pool;
};
export type DB = pg.PoolClient;
export async function transaction<T>(
  pool: pg.Pool,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let discard = false;
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    discard = isConnectionError(error) || connectionFailures.has(db);
    if (!discard) {
      try {
        await db.query("ROLLBACK");
      } catch (rollbackError) {
        discard = true;
        report("postgres.rollback_failed", rollbackError);
      }
    }
    // In particular, do not replace an ambiguous COMMIT/connection failure with
    // the ROLLBACK failure. No automatic mutation retries are performed here.
    throw error;
  } finally {
    db.release(discard || connectionFailures.has(db));
  }
}
