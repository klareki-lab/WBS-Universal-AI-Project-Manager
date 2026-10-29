import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { stringify } from "yaml";
import { specs } from "./api-contract.js";
import * as s from "./schemas.js";
const root = new URL("../../../packages/contracts/", import.meta.url);
await mkdir(new URL("schemas/", root), { recursive: true });
const schemas: Record<string, unknown> = {};
function schema(name: string, value: z.ZodType, input = false) {
  const result = z.toJSONSchema(value, {
    io: input ? "input" : "output",
    unrepresentable: "throw",
  });
  delete result.$schema;
  schemas[name] = result;
  return { $ref: `#/components/schemas/${name}` };
}
const error = schema("Error", s.errorResponse),
  user = schema("User", s.userResponse),
  login = schema("LoginRequest", s.login, true);
const responses = (response: unknown, status: number) => ({
  [status]: {
    description: "Success",
    content: { "application/json": { schema: response } },
  },
  ...Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 429, 500, 503].map((code) => [
      code,
      {
        description:
          (
            {
              "400": "Invalid input",
              "401": "Unauthenticated",
              "403": "Forbidden or CSRF failure",
              "404": "Resource unavailable",
              "409": "State/version/idempotency conflict",
            } as any
          )[code] ?? "Request failure",
        content: { "application/json": { schema: error } },
      },
    ]),
  ),
});
const paths: Record<string, any> = {};
const security = [{ cookieAuth: [] }, { serviceBearer: [] }];
for (const [name, spec] of Object.entries(specs)) {
  const path = spec.url.replace(/:([a-zA-Z]+)/g, "{$1}");
  const parameters: any[] = [...spec.url.matchAll(/:([a-zA-Z]+)/g)].map(
    (m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }),
  );
  if (spec.query) {
    const q = z.toJSONSchema(spec.query, { io: "input" }) as any;
    for (const [key, value] of Object.entries(q.properties))
      parameters.push({
        name: key,
        in: "query",
        required: false,
        schema: value,
      });
  }
  if (spec.method !== "GET")
    parameters.push(
      {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: {
          type: "string",
          minLength: 8,
          maxLength: 200,
          pattern: "^[A-Za-z0-9_.:-]+$",
        },
      },
      {
        name: "X-CSRF-Token",
        in: "header",
        required: false,
        description:
          "Mandatory with cookie authentication on mutations; obtain from login.",
        schema: { type: "string" },
      },
    );
  const op: any = {
    operationId: name,
    summary: spec.summary,
    tags: [
      name.includes("Plan") ||
      name.includes("Review") ||
      name.includes("Approval")
        ? "Planning"
        : "Core",
    ],
    security: spec.human
      ? [{ cookieAuth: [] }]
      : spec.serviceOnly
        ? [{ serviceBearer: [] }]
        : security,
    parameters,
    "x-service-scope": spec.scope,
    "x-required-service-scopes": [spec.scope, ...(spec.additionalScopes ?? [])],
    "x-human-only": Boolean(spec.human),
    responses: responses(
      schema(name + "Response", spec.response),
      spec.status ?? 200,
    ),
  };
  if (spec.body)
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: schema(name + "Request", spec.body, true),
        },
      },
    };
  paths[path] ??= {};
  paths[path][spec.method.toLowerCase()] = op;
}
paths["/api/v1/auth/login"] = {
  post: {
    operationId: "login",
    summary:
      "Authenticate a provisioned human; return CSRF token and HttpOnly session cookie",
    security: [],
    requestBody: {
      required: true,
      content: { "application/json": { schema: login } },
    },
    responses: responses(
      schema(
        "LoginResponse",
        z.object({
          user: s.userResponse,
          csrf_token: z.string(),
          expires_at: z.iso.datetime(),
        }),
      ),
      200,
    ),
  },
};
for (const route of ["me", "session"])
  paths["/api/v1/auth/" + route] = {
    get: {
      operationId: route === "me" ? "currentUser" : "validateSession",
      security,
      responses: responses(user, 200),
    },
  };
paths["/api/v1/auth/csrf"] = {
  get: {
    operationId: "csrfBootstrap",
    summary:
      "Get stable CSRF token for current human HttpOnly session after reload",
    security: [{ cookieAuth: [] }],
    responses: responses(
      schema("CsrfResponse", z.object({ csrf_token: z.string() })),
      200,
    ),
  },
};
paths["/api/v1/auth/logout"] = {
  post: {
    operationId: "logout",
    summary: "Revoke current human session",
    security: [{ cookieAuth: [] }],
    parameters: [
      {
        name: "X-CSRF-Token",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      204: { description: "Session revoked" },
      403: {
        description: "Invalid CSRF",
        content: { "application/json": { schema: error } },
      },
      401: {
        description: "No session",
        content: { "application/json": { schema: error } },
      },
    },
  },
};
for (const path of ["/health", "/ready"])
  paths[path] = {
    get: {
      operationId: path === "/health" ? "health" : "readiness",
      security: [],
      responses: {
        200: {
          description: "Healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { status: { type: "string" } },
                required: ["status"],
                additionalProperties: false,
              },
            },
          },
        },
        503: { description: "Database not ready" },
      },
    },
  };
const doc = {
  openapi: "3.1.0",
  info: {
    title: "Universal AI Project Manager Backend",
    version: "1.1.0",
    description:
      "Canonical v1 contract. Mutations require Idempotency-Key. Cookie writes also require X-CSRF-Token. Human approval binds immutable content hash; services cannot approve. Task metadata PATCH returns a draft plan requiring approval and publication. Lists use limit/offset. HTTP errors contain stable request_id.",
  },
  servers: [{ url: "http://localhost:13081" }],
  paths,
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "uapm_session" },
      serviceBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "90-day service token, stored hashed; explicit project membership and endpoint scope required.",
      },
    },
    schemas,
  },
};
await writeFile(
  new URL("openapi.yaml", root),
  stringify(doc, { aliasDuplicateObjects: false }),
);
for (const [name, value] of Object.entries(schemas))
  await writeFile(
    new URL("schemas/" + name + ".json", root),
    JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...(value as object),
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  `Generated ${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas`,
);
