import { z } from "zod";

const ConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().positive().default(3002),
  host: z.string().default("0.0.0.0"),
  backendMode: z.enum(["mock", "http"]).default("mock"),
  backendBaseUrl: z.string().url().optional(),
  backendServiceToken: z.string().min(1).optional(),
  mcpServiceToken: z.string().min(1).default("dev-local-service-token"),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  requestTimeoutMs: z.coerce.number().int().positive().default(10_000),
  maxRetries: z.coerce.number().int().min(0).max(5).default(2),
  maxPageSize: z.coerce.number().int().positive().max(500).default(100),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const raw = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.MCP_PORT ?? process.env.PORT,
    host: process.env.MCP_HOST,
    backendMode: process.env.UAPM_BACKEND_MODE,
    backendBaseUrl: process.env.UAPM_BACKEND_BASE_URL,
    backendServiceToken: process.env.UAPM_BACKEND_SERVICE_TOKEN,
    mcpServiceToken: process.env.UAPM_MCP_SERVICE_TOKEN,
    logLevel: process.env.LOG_LEVEL,
    requestTimeoutMs: process.env.UAPM_REQUEST_TIMEOUT_MS,
    maxRetries: process.env.UAPM_MAX_RETRIES,
    maxPageSize: process.env.UAPM_MAX_PAGE_SIZE,
  };
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid MCP server config: ${issues}`);
  }
  if (parsed.data.backendMode === "http" && !parsed.data.backendBaseUrl) {
    throw new Error("UAPM_BACKEND_BASE_URL is required when UAPM_BACKEND_MODE=http");
  }
  return parsed.data;
}
