import pino from "pino";
import { loadConfig } from "./config.js";

const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();

const redactPaths = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
  "token",
  "apiKey",
  "api_key",
  "password",
  "secret",
  "*.authorization",
  "*.token",
  "*.password",
  "*.secret",
];

export const logger = pino({
  level: config?.logLevel ?? process.env.LOG_LEVEL ?? "info",
  base: { service: "uapm-mcp" },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function withCorrelation(correlationId: string) {
  return logger.child({ correlationId });
}
