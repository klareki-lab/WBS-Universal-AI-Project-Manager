import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "../backend/types.js";
import type { Principal } from "../schemas.js";
import { errorToToolPayload } from "../errors.js";

type Ctx = { getPrincipal: () => Principal; backend: BackendClient };

export function registerResources(server: McpServer, ctx: Ctx): void {
  server.registerResource(
    "project_overview",
    new ResourceTemplate("project://{id}/overview", { list: undefined }),
    {
      title: "Project overview",
      description: "Project overview, summary and progress for the given project ID.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id);
      try {
        const principal = ctx.getPrincipal();
        const [project, progress] = await Promise.all([
          ctx.backend.getProject(principal, id),
          ctx.backend.getProjectProgress(principal, id),
        ]);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ project, progress }, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(errorToToolPayload(e)),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    "project_current_plan",
    new ResourceTemplate("project://{id}/plan/current", { list: undefined }),
    {
      title: "Current project plan",
      description: "Current published plan for the project, or an object with planVersion=null if no plan is published.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id);
      try {
        const planVersion = await ctx.backend.getCurrentPublishedPlan(ctx.getPrincipal(), id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ projectId: id, planVersion }, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(errorToToolPayload(e)),
            },
          ],
        };
      }
    },
  );
}
export const _schemaRefs = {};
