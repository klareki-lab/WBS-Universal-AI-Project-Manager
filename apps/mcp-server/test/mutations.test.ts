import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeClient, parseStructured, startTestServer, type TestHarness } from "./helpers.ts";

const samplePlan = () => ({
  summary: "Launch MVP site",
  assumptions: ["Content copy will be provided by marketing by week 3."],
  risks: ["Vendor delay for payment integration."],
  phases: [
    { name: "Discovery", order: 0, description: "Understand goals" },
    { name: "Build", order: 1, description: "Implement MVP" },
  ],
  tasks: [
    {
      tempId: "t1",
      phaseName: "Discovery",
      title: "Interview stakeholders",
      priority: "high" as const,
      dependsOn: [],
      definitionOfDone: "Interview notes stored and summarized.",
    },
    {
      tempId: "t2",
      phaseName: "Build",
      title: "Set up repo and CI",
      priority: "medium" as const,
      dependsOn: ["t1"],
      definitionOfDone: "Repo exists, CI runs tests.",
    },
  ],
});

describe("Approval + publication flow (end-to-end against mock backend)", () => {
  let h: TestHarness;
  before(async () => {
    h = await startTestServer();
  });
  after(async () => h.stop());

  it("full planner → reviewer → draft → request approval → human decide → publish → progress → task metadata proposal", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });

    // Work with the seeded demo project (human-only policy is enforced by the
    // HttpBackendClient — covered in test/http-client-contract.test.ts).
    const projectId = "prj_demo";

    const draft = parseStructured<{ planVersion: any; operationId: string }>(
      await client.callTool({
        name: "create_plan_draft",
        arguments: { projectId, plan: samplePlan(), idempotencyKey: `idem-draft-${randomUUID()}` },
      }),
    );
    assert.equal(draft.planVersion.status, "draft");

    const proposal = parseStructured<{ planVersion: any }>(
      await client.callTool({
        name: "propose_plan_changes",
        arguments: {
          projectId,
          basePlanVersionId: draft.planVersion.id,
          plan: samplePlan(),
          rationale: "Refined after review",
          idempotencyKey: `idem-prop-${randomUUID()}`,
        },
      }),
    );
    assert.equal(proposal.planVersion.status, "proposed");
    const planVersionId: string = proposal.planVersion.id;

    // Agent cannot publish without approval
    const prematurePublish = await client.callTool({
      name: "publish_approved_plan",
      arguments: {
        projectId,
        planVersionId,
        contentHash: proposal.planVersion.contentHash,
        idempotencyKey: `idem-pub-${randomUUID()}`,
      },
    });
    assert.ok(prematurePublish.isError, "publish before approval must fail");
    assert.equal(parseStructured<{ error: { code: string } }>(prematurePublish).error.code, "approval_required");

    // Request approval (service plans:write scope)
    const req = parseStructured<{ approval: any }>(
      await client.callTool({
        name: "request_plan_approval",
        arguments: { projectId, planVersionId, idempotencyKey: `idem-req-${randomUUID()}` },
      }),
    );
    assert.equal(req.approval.state, "pending");

    // Simulate human decidePlan out-of-band
    h.backend.approvePlanAsHuman(planVersionId, "user_human_reviewer", "Looks good");

    const approvalRead = parseStructured<{ state: string; decidedBy: string | null }>(
      await client.callTool({ name: "get_approval_status", arguments: { projectId, planVersionId } }),
    );
    assert.equal(approvalRead.state, "approved");

    // Publish with content_hash binding and matching idempotency key
    const pubKey = `idem-pub-ok-${randomUUID()}`;
    const published = parseStructured<{ publishedTaskIds: string[] }>(
      await client.callTool({
        name: "publish_approved_plan",
        arguments: {
          projectId,
          planVersionId,
          contentHash: proposal.planVersion.contentHash,
          idempotencyKey: pubKey,
        },
      }),
    );
    assert.equal(published.publishedTaskIds.length, 2);

    // Duplicate publish — rejected
    const dup = await client.callTool({
      name: "publish_approved_plan",
      arguments: {
        projectId,
        planVersionId,
        contentHash: proposal.planVersion.contentHash,
        idempotencyKey: pubKey,
      },
    });
    assert.ok(dup.isError, "duplicate publish must be rejected");
    const dupCode = parseStructured<{ error: { code: string } }>(dup).error.code;
    assert.ok(["idempotency_conflict", "conflict"].includes(dupCode), `unexpected dup code ${dupCode}`);

    // Content hash mismatch — rejected
    const badHash = await client.callTool({
      name: "publish_approved_plan",
      arguments: {
        projectId,
        planVersionId,
        contentHash: "f".repeat(64),
        idempotencyKey: `idem-pub-badhash-${randomUUID()}`,
      },
    });
    assert.ok(badHash.isError, "content hash mismatch must be rejected");

    const progress = parseStructured<{ counts: { total: number } }>(
      await client.callTool({ name: "get_project_progress", arguments: { projectId } }),
    );
    assert.ok(progress.counts.total >= 2);

    // Pick a task and test the proposal flow via update_task
    const tasksPage = parseStructured<{ items: any[] }>(
      await client.callTool({ name: "list_project_tasks", arguments: { projectId } }),
    );
    const firstTask = tasksPage.items[0];
    const detail = parseStructured<{ version: number }>(
      await client.callTool({ name: "get_task", arguments: { projectId, taskId: firstTask.id } }),
    );

    // update_task_status is human-only in the real backend. The mock emulates the
    // human-approved happy path (so the end-to-end seeding flow in CI works);
    // the HttpBackendClient enforces `human_only` without a network call. That
    // is covered in test/http-client-contract.test.ts.
    const statusChange = parseStructured<{ task: { status: string } }>(
      await client.callTool({
        name: "update_task_status",
        arguments: {
          projectId,
          taskId: firstTask.id,
          expectedVersion: detail.version,
          status: "in_progress",
          idempotencyKey: `idem-ts-${randomUUID()}`,
        },
      }),
    );
    assert.equal(statusChange.task.status, "in_progress");

    // Re-read the task because update_task_status bumped its version.
    const fresh = parseStructured<{ version: number }>(
      await client.callTool({ name: "get_task", arguments: { projectId, taskId: firstTask.id } }),
    );

    // update_task returns a proposed PlanVersion (NOT an applied change)
    const proposedChange = parseStructured<{ proposedPlanVersion: { status: string }; requiresApproval: true; nextSteps: string[] }>(
      await client.callTool({
        name: "update_task",
        arguments: {
          projectId,
          taskId: firstTask.id,
          expectedVersion: fresh.version,
          changes: { description: "Refined description" },
          idempotencyKey: `idem-ut-${randomUUID()}`,
        },
      }),
    );
    assert.equal(proposedChange.proposedPlanVersion.status, "draft");
    assert.equal(proposedChange.requiresApproval, true);
    assert.ok(proposedChange.nextSteps.length >= 2);

    await client.close();
  });

  it("get_operation_status returns not_found for bogus operation", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const res = await client.callTool({ name: "get_operation_status", arguments: { operationId: "op_does_not_exist" } });
    assert.ok(res.isError);
    assert.equal(parseStructured<{ error: { code: string } }>(res).error.code, "not_found");
    await client.close();
  });

  it("create_project schema rejects missing idempotencyKey", async () => {
    const client = await makeClient(h.baseUrl, { userId: "user_demo" });
    const res = await client.callTool({ name: "create_project", arguments: { name: "no-idem" } as any });
    assert.ok(res.isError);
    await client.close();
  });
});
