import { it, expect, vi } from "vitest";
import type pg from "pg";
import { transaction, isConnectionError } from "../src/db.js";
it("F1 rollback failure preserves original error and discards the broken client", async () => {
  const primary = Object.assign(new Error("original statement failure"), {
      code: "23505",
    }),
    rollback = Object.assign(new Error("Connection terminated unexpectedly"), {
      code: "ECONNRESET",
    });
  const release = vi.fn(),
    query = vi.fn(async (sql: string) => {
      if (sql === "ROLLBACK") throw rollback;
      return {};
    });
  const fake = {
    connect: async () => ({ query, release }),
  } as unknown as pg.Pool;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      transaction(fake, async () => {
        throw primary;
      }),
    ).rejects.toBe(primary);
    expect(release).toHaveBeenCalledWith(true);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  } finally {
    log.mockRestore();
  }
});
it("F1 connection failures are classified without treating ordinary SQL conflicts as outages", () => {
  expect(
    isConnectionError(
      Object.assign(new Error("disconnect"), { code: "57P01" }),
    ),
  ).toBe(true);
  expect(
    isConnectionError(new Error("Connection terminated unexpectedly")),
  ).toBe(true);
  expect(
    isConnectionError(Object.assign(new Error("unique"), { code: "23505" })),
  ).toBe(false);
});
