import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";

describe("Log redaction", () => {
  it("redacts common secret paths", () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => chunks.push(s) };
    const log = pino(
      {
        redact: { paths: ["token", "password", "authorization", "api_key"], censor: "[REDACTED]" },
        base: {},
      },
      stream as any,
    );
    log.info({ token: "secret-abc", password: "p", authorization: "Bearer x", api_key: "k" }, "boom");
    const line = chunks[0]!;
    assert.ok(line.includes("[REDACTED]"));
    assert.ok(!line.includes("secret-abc"));
    assert.ok(!line.includes("Bearer x"));
  });
});
