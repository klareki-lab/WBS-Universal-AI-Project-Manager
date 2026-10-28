import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { makeClient, parseStructured, startTestServer, type TestHarness } from "./helpers.ts";

describe("Read-only access and authorization", () => {
  let h: TestHarness;
  before(async () => {
    h = await startTestServer();
  });
  after(async () => h.stop());

  it("list_projects returns only projects the user has access to", async () => {
    const authorized = await makeClient(h.baseUrl, { userId: "user_demo" });
    const okList = await authorized.callTool({ name: "list_projects", arguments: {} });
    const page = parseStructured<{ items: any[] }>(okList);
    assert.ok(page.items.some((p) => p.id === "prj_demo"));
    await authorized.close();

    const stranger = await makeClient(h.baseUrl, { userId: "user_outsider" });
    const strangerList = await stranger.callTool({ name: "list_projects", arguments: {} });
    const strangerPage = parseStructured<{ items: any[] }>(strangerList);
    assert.equal(strangerPage.items.length, 0);
    await stranger.close();
  });

  it("get_project denies cross-project access", async () => {
    const stranger = await makeClient(h.baseUrl, { userId: "user_outsider" });
    const res = await stranger.callTool({ name: "get_project", arguments: { id: "prj_demo" } });
    assert.ok(res.isError, "expected forbidden");
    const payload = parseStructured<{ error: { code: string } }>(res);
    assert.equal(payload.error.code, "forbidden");
    await stranger.close();
  });

  it("get_task denies non-member", async () => {
    const stranger = await makeClient(h.baseUrl, { userId: "user_outsider" });
    const res = await stranger.callTool({ name: "get_task", arguments: { id: "tsk_demo_1" } });
    assert.ok(res.isError);
    await stranger.close();
  });

  it("get_project_progress works for a member", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const res = await client.callTool({ name: "get_project_progress", arguments: { projectId: "prj_demo" } });
    const p = parseStructured<{ counts: { total: number } }>(res);
    assert.equal(p.counts.total, 1);
    await client.close();
  });

  it("project overview resource respects permission model", async () => {
    const stranger = await makeClient(h.baseUrl, { userId: "user_outsider" });
    const res = await stranger.readResource({ uri: "project://prj_demo/overview" });
    const body = JSON.parse(res.contents[0]!.text as string);
    assert.ok(body.error, "overview should return error for stranger");
    await stranger.close();
  });
});
