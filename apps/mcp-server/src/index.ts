import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { buildHttpApp } from "./server.js";
import { MockBackend } from "./mock/backend.js";
import { HttpBackendClient } from "./backend/http-client.js";
import type { BackendClient } from "./backend/types.js";

function selectBackend(): BackendClient {
  const cfg = loadConfig();
  if (cfg.backendMode === "mock") {
    logger.warn("Backend running in MOCK mode — contract-compatible in-memory store. Not for production.");
    return new MockBackend();
  }
  logger.info({ baseUrl: cfg.backendBaseUrl }, "Backend running in HTTP mode");
  return new HttpBackendClient(cfg);
}

async function main() {
  const cfg = loadConfig();
  const backend = selectBackend();
  const app = buildHttpApp(cfg, backend);
  const server = app.listen(cfg.port, cfg.host, () => {
    logger.info({ host: cfg.host, port: cfg.port, mode: cfg.backendMode }, "uapm-mcp listening");
  });
  const shutdown = (sig: string) => {
    logger.info({ sig }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err: err?.message }, "fatal startup error");
  process.exit(1);
});
