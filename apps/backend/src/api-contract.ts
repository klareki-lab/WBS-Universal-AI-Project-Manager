import { z } from "zod";
import * as s from "./schemas.js";
export type Spec = {
  method: "GET" | "POST" | "PATCH";
  url: string;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response: z.ZodType;
  scope: string;
  human?: boolean;
  serviceOnly?: boolean;
  additionalScopes?: string[];
  status?: number;
};
const p = "/api/v1/projects/:projectId";
export const specs: Record<string, Spec> = {
  createProject: {
    method: "POST",
    url: "/api/v1/projects",
    summary: "Create an owned project",
    body: s.projectCreate,
    response: s.projectResponse,
    scope: "projects:write",
    human: true,
    status: 201,
  },
  listProjects: {
    method: "GET",
    url: "/api/v1/projects",
    summary: "List accessible projects",
    query: s.pageQuery,
    response: s.collection(s.projectResponse),
    scope: "read",
  },
  getProject: {
    method: "GET",
    url: p,
    summary: "Get project metadata",
    response: s.projectResponse,
    scope: "read",
  },
  updateProject: {
    method: "PATCH",
    url: p,
    summary: "Update project with optimistic version",
    body: s.projectUpdate,
    response: s.projectResponse,
    scope: "projects:write",
    human: true,
  },
  dashboard: {
    method: "GET",
    url: p + "/dashboard",
    summary: "Read phase and task progress",
    response: z.object({
      project: s.projectResponse,
      phases: z.array(s.phaseResponse),
      total: z.number().int(),
      by_status: z.record(z.string(), z.number().int()),
      progress_percent: z.number(),
    }),
    scope: "read",
  },
  listTasks: {
    method: "GET",
    url: p + "/tasks",
    summary: "Search and filter tasks",
    query: s.listQuery,
    response: s.collection(s.taskResponse),
    scope: "read",
  },
  getTask: {
    method: "GET",
    url: p + "/tasks/:taskId",
    summary: "Get one task",
    response: s.taskResponse,
    scope: "read",
  },
  taskStatus: {
    method: "PATCH",
    url: p + "/tasks/:taskId/status",
    summary: "Transition status with version and dependency checks",
    body: s.statusUpdate,
    response: s.taskResponse,
    scope: "tasks:write",
    human: true,
  },
  taskMetadata: {
    method: "PATCH",
    url: p + "/tasks/:taskId",
    summary: "Create a material-change proposal; no direct task mutation",
    body: s.metadataUpdate,
    response: s.planResponse,
    scope: "plans:write",
    status: 201,
  },
  dependencies: {
    method: "GET",
    url: p + "/tasks/:taskId/dependencies",
    summary: "Read predecessor dependencies",
    response: z.object({
      items: z.array(
        z.object({
          project_id: s.uuid,
          task_id: s.uuid,
          depends_on_id: s.uuid,
        }),
      ),
    }),
    scope: "read",
  },
  createPlan: {
    method: "POST",
    url: p + "/plans",
    summary: "Save immutable structured plan draft",
    body: s.planCreate,
    response: s.planResponse,
    scope: "plans:write",
    status: 201,
  },
  listPlans: {
    method: "GET",
    url: p + "/plans",
    summary: "List immutable plan versions",
    query: s.pageQuery,
    response: s.collection(s.planResponse),
    scope: "read",
  },
  getPlan: {
    method: "GET",
    url: p + "/plans/:planId",
    summary: "Get exact plan snapshot and hash",
    response: s.planResponse,
    scope: "read",
  },
  proposeChanges: {
    method: "POST",
    url: p + "/change-proposals",
    summary: "Create a new immutable plan and change proposal",
    body: s.proposalCreate,
    response: s.planResponse,
    scope: "plans:write",
    status: 201,
  },
  submitReview: {
    method: "POST",
    url: p + "/plans/:planId/submit-review",
    summary: "Submit exact draft for human review",
    response: s.planResponse,
    scope: "plans:write",
  },
  requestApproval: {
    method: "POST",
    url: p + "/plans/:planId/request-approval",
    summary: "Record approval request for a draft or in-review version",
    response: s.planResponse,
    scope: "plans:write",
  },
  decidePlan: {
    method: "POST",
    url: p + "/plans/:planId/approvals",
    summary: "Human approves or rejects exact content hash",
    body: s.decision,
    response: s.approvalResponse,
    scope: "approvals:write",
    human: true,
    status: 201,
  },
  publishPlan: {
    method: "POST",
    url: p + "/plans/:planId/publish",
    summary: "Atomically publish approved snapshot once",
    body: s.hashInput,
    response: s.operationResponse,
    scope: "plans:publish",
  },
  listOperations: {
    method: "GET",
    url: p + "/operations",
    summary: "List durable operations",
    query: s.pageQuery,
    response: s.collection(s.operationResponse),
    scope: "read",
  },
  getOperation: {
    method: "GET",
    url: "/api/v1/operations/:operationId",
    summary: "Read authorized operation status/result",
    response: s.operationResponse,
    scope: "read",
  },
  audit: {
    method: "GET",
    url: p + "/activity",
    summary: "Read append-only activity history",
    query: s.pageQuery,
    response: s.collection(s.eventResponse),
    scope: "read",
  },
  planningRequest: {
    method: "POST",
    url: p + "/agent/planning-requests",
    summary: "Queue a durable n8n planning request",
    body: s.planningRequest,
    response: s.operationResponse,
    scope: "operations:write",
    status: 202,
  },
  operationResult: {
    method: "POST",
    url: "/api/v1/operations/:operationId/result",
    summary: "Scoped service stores planning result as a draft",
    body: s.operationResult,
    response: s.operationResponse,
    scope: "operations:write",
    additionalScopes: ["plans:write"],
    serviceOnly: true,
  },
  conversation: {
    method: "POST",
    url: p + "/conversations",
    summary: "Store project-scoped conversation correlation",
    body: s.conversationCreate,
    response: s.conversationResponse,
    scope: "operations:write",
    status: 201,
  },
};
