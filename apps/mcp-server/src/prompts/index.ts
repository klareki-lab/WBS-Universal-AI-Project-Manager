import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "plan_project",
    {
      title: "Plan a project",
      description:
        "Reusable instructions for producing a structured, schema-conformant project plan. Domain-agnostic; works for software, marketing, business ops, events, custom projects.",
      argsSchema: {
        goal: z.string().min(1).describe("Primary project goal in one or two sentences."),
        domain: z.string().optional().describe("Project domain (software, marketing, event, operations, custom...)."),
        constraints: z.string().optional().describe("Known constraints: deadlines, budgets, dependencies, team size."),
        knownUnknowns: z.string().optional().describe("Information the user does not yet have — assume and flag."),
      },
    },
    ({ goal, domain, constraints, knownUnknowns }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `You are a senior project planner. Produce a structured project plan for the goal below.`,
              `Goal: ${goal}`,
              domain ? `Domain: ${domain}` : undefined,
              constraints ? `Constraints: ${constraints}` : undefined,
              knownUnknowns ? `Known unknowns: ${knownUnknowns}` : undefined,
              ``,
              `Rules:`,
              `1. Return a plan matching the PlanDraft schema used by the uapm-mcp server (summary, assumptions[], risks[], phases[{name, order, description?}], tasks[{tempId, phaseName, title, description?, priority, dependsOn[], estimateHours?, definitionOfDone?, owner?, dueDate?}]).`,
              `2. Do NOT invent owners, confirmed dates or external approvals. If information is missing, add an assumption instead of claiming a fact.`,
              `3. Each task must have a measurable Definition of Done.`,
              `4. Use at least 2 phases and task dependencies only via tempId references within the plan.`,
              `5. Do not call any tools from this prompt — the orchestration layer validates the result and decides what to persist via the MCP server.`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_project_plan",
    {
      title: "Review a project plan",
      description:
        "Reusable instructions for quality review of a project plan. Returns specific corrections and warnings.",
      argsSchema: {
        planJson: z.string().min(1).describe("Serialized JSON of the PlanDraft to review."),
        focusAreas: z.string().optional().describe("Optional focus areas, e.g. 'timeline', 'dependencies', 'owners'."),
      },
    },
    ({ planJson, focusAreas }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `You are a critical plan reviewer for the Universal AI Project Manager.`,
              `Review this plan and return a structured JSON object with keys:`,
              `  { "ok": boolean, "issues": [ { "severity": "info|warning|error", "taskRef": "tempId or null", "category": "clarity|duplicate|phase|dependency|timeline|owner|dod|unsupported_claim", "message": string, "suggestion": string? } ], "revisedPlan": PlanDraft | null }`,
              `Checks you MUST perform:`,
              `- Task clarity (vague verbs, missing object, missing measurable outcome).`,
              `- Duplicates and near-duplicates across phases.`,
              `- Phase consistency (every task belongs to a declared phase, order is monotonic).`,
              `- Dependency validity (no cycles, no references to unknown tempIds, no cross-phase shortcuts without rationale).`,
              `- Timeline sanity (do estimates fit stated dueDate; are any dates impossible given dependencies).`,
              `- Owners/dates: flag any owner or date asserted as confirmed without supporting assumption.`,
              `- Definition of Done presence and measurability.`,
              focusAreas ? `Additional focus areas: ${focusAreas}` : undefined,
              ``,
              `Plan to review:`,
              planJson,
              ``,
              `Return ONLY the JSON object. Do not call tools.`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );
}
