import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { buildHttpApp } from "../src/server.js";
import { MockBackend } from "../src/mock/backend.js";
import { loadConfig } from "../src/config.js";

export interface TestHarness {
  baseUrl: string;
  backend: MockBackend;
  stop: () => Promise<void>;
}

export async function startTestServer(opts: { serviceToken?: string } = {}): Promise<TestHarness> {
  process.env.UAPM_BACKEND_MODE = "mock";
  process.env.UAPM_MCP_SERVICE_TOKEN = opts.serviceToken ?? "test-token";
  process.env.LOG_LEVEL = "fatal";
  const cfg = loadConfig();
  const backend = new MockBackend();
  const app = buildHttpApp(cfg, backend);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    backend,
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

export async function makeClient(baseUrl: string, opts: { userId?: string; serviceToken?: string } = {}): Promise<Client> {
  const token = opts.serviceToken ?? "test-token";
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-service-subject": "uapm-mcp-test",
  };
  if (opts.userId) headers["x-on-behalf-of"] = opts.userId;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: "uapm-mcp-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

export function parseStructured<T = any>(result: any): T {
  if (result.structuredContent) return result.structuredContent as T;
  const text = result.content?.[0]?.text ?? "{}";
  return JSON.parse(text) as T;
}
