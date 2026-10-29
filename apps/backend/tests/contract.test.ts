import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import SwaggerParser from "@apidevtools/swagger-parser";
import { specs } from "../src/api-contract.js";
import { snapshot, planCreate } from "../src/schemas.js";
const root = new URL("../../../packages/contracts/", import.meta.url);
it("validates the canonical OpenAPI 3.1 document and all implemented operation IDs", async () => {
  const doc = parse(await readFile(new URL("openapi.yaml", root), "utf8"));
  await SwaggerParser.validate(doc);
  const operations = Object.values(doc.paths).flatMap((path: any) =>
    Object.values(path).map((operation: any) => operation.operationId),
  );
  for (const name of Object.keys(specs)) expect(operations).toContain(name);
  expect(new Set(operations).size).toBe(operations.length);
});
it("keeps published request JSON Schema synchronized with the runtime schema", async () => {
  const schema = JSON.parse(
    await readFile(new URL("schemas/createPlanRequest.json", root), "utf8"),
  );
  const { z } = await import("zod");
  const expected = z.toJSONSchema(planCreate, { io: "input" });
  expect(schema).toEqual(expected);
  const input = planCreate.parse(
    JSON.parse(
      await readFile(new URL("fixtures/plan-create.json", root), "utf8"),
    ),
  );
  expect(input.snapshot.tasks).toHaveLength(12);
  expect(snapshot.safeParse(input.snapshot).success).toBe(true);
});
