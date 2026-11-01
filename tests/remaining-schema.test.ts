import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations/0003_remaining_tables/migration.sql"),
  "utf8",
);

const TABLES = [
  "Vehicle",
  "Fitment",
  "VinDecode",
  "Listing",
  "Seller",
  "OrderLine",
  "SearchLog",
  "SearchEval",
  "PolicyRule",
  "SystemStandIn",
  "ImportRun",
  "DataQualityIssue",
  "Basket",
  "BasketItem",
  "AdvisorSession",
  "EvalRun",
  "LatencySample",
] as const;

describe("remaining tables migration", () => {
  it("creates every scoped table", () => {
    for (const table of TABLES) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(schema).toContain(`model ${table}`);
    }
  });

  it("indexes Fitment on (vehicleId, sku) and on (sku)", () => {
    expect(migration).toContain(
      'CREATE INDEX "Fitment_vehicleId_sku_idx" ON "Fitment"("vehicleId", "sku")',
    );
    expect(migration).toContain('CREATE INDEX "Fitment_sku_idx" ON "Fitment"("sku")');
  });

  it("has no user, account, ticket, pricing or MCP tables", () => {
    const forbidden = [
      "User",
      "Account",
      "Ticket",
      "MarketPrice",
      "Pricing",
      "McpServer",
      "KnowledgeBase",
    ];
    for (const name of forbidden) {
      expect(schema).not.toMatch(new RegExp(`model\\s+${name}\\b`));
      expect(migration).not.toContain(`CREATE TABLE "${name}"`);
    }
  });
});
