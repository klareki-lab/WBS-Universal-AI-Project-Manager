import { it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { httpAdapter } from "../src/worker.js";
import { token } from "../src/security.js";
it("delivers real internal HTTP with operation idempotency/correlation, handles async acceptance and refuses redirects", async () => {
  const secret = token();
  let received: any;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = { headers: req.headers, body: JSON.parse(raw) };
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/accepted" });
      res.end();
    } else if (req.url === "/accepted") {
      res.writeHead(202);
      res.end();
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Clarification required" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const job = {
      id: "c7f6fc84-5328-4c44-b25f-d5f90dc9716c",
      project_id: "b6b74ef7-d13f-428a-a1ab-4ebc358202c7",
      conversation_session_id: null,
      input: { prompt: "Prepare draft", base_project_version: 1 },
    };
    expect(await httpAdapter(endpoint, secret)(job)).toEqual({
      error: "Clarification required",
    });
    expect(received.headers.authorization).toBe("Bearer " + secret);
    expect(received.headers["idempotency-key"]).toBe(job.id);
    expect(received.body.callback_path).toBe(
      `/api/v1/operations/${job.id}/result`,
    );
    expect(received.body).not.toHaveProperty("database_url");
    expect(await httpAdapter(endpoint + "/accepted", secret)(job)).toEqual({
      accepted: true,
    });
    await expect(
      httpAdapter(endpoint + "/redirect", secret)(job),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
