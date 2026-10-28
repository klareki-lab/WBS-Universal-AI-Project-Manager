import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
it("refuses user provisioning when required administrative variables are absent", async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
  };
  delete env.ADMIN_EMAIL;
  delete env.ADMIN_PASSWORD;
  delete env.ADMIN_NAME;
  await expect(
    exec(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/admin.ts", "create-user"],
      { env },
    ),
  ).rejects.toThrow();
});
it("does not accept privileged or wildcard service scopes", async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SERVICE_NAME: "limited-test",
    SERVICE_PROJECT_ID: "b6b74ef7-d13f-428a-a1ab-4ebc358202c7",
    SERVICE_SCOPES: "approvals:write",
  };
  await expect(
    exec(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/admin.ts", "create-service"],
      { env },
    ),
  ).rejects.toThrow();
});
