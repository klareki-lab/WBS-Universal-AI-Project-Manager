import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { makeClient, startTestServer, type TestHarness } from "./helpers.ts";

describe("MCP initialization and discovery", () => {
  let h: TestHarness;
  before(async () => {
    h = await startTestServer();
  });
  after(async () => h.stop());

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
  });

  it("initializes and lists 16 tools", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    const expected = [
      "create_plan_draft",
      "create_project",
      "get_approval_status",
      "get_operation_status",
      "get_plan_version",
      "get_project",
      "get_project_progress",
      "get_task",
      "list_activity_history",
      "list_project_tasks",
      "list_projects",
      "propose_plan_changes",
      "publish_approved_plan",
      "request_plan_approval",
      "update_task",
      "update_task_status",
    ];
    assert.deepEqual(names, expected);
    for (const t of tools.tools) {
      assert.ok(t.inputSchema, `tool ${t.name} missing inputSchema`);
      assert.ok(t.description && t.description.length > 0, `tool ${t.name} missing description`);
    }
    await client.close();
  });

  it("lists both resources", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const templates = await client.listResourceTemplates();
    const uris = templates.resourceTemplates.map((r) => r.uriTemplate).sort();
    assert.deepEqual(uris, ["project://{id}/overview", "project://{id}/plan/current"]);
    await client.close();
  });

  it("lists both prompts", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const prompts = await client.listPrompts();
    const names = prompts.prompts.map((p) => p.name).sort();
    assert.deepEqual(names, ["plan_project", "review_project_plan"]);
    await client.close();
  });
});
