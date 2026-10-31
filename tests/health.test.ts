import { describe, expect, it } from "vitest";
import { checkHealth } from "../src/lib/health";

describe("checkHealth", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is ok when the database answers", async () => {
    expect(await checkHealth(async () => 1, now)).toEqual({ status: "ok", database: "up", checkedAt: now.toISOString() });
  });

  it("is degraded, not failing, when the database is down", async () => {
    const health = await checkHealth(async () => {
      throw new Error("connection refused");
    }, now);
    expect(health).toMatchObject({ status: "degraded", database: "down" });
  });
});
