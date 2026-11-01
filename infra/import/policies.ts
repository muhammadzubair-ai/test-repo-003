import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { num, str, type SheetRows } from "./workbook";

/**
 * Policies precedence at import (ARCH-60).
 *
 * PolicyRule keys map onto the Option 2 fields they govern. The delivery
 * rule governs Listing.deliveryDays. Where that loaded value disagrees,
 * the Policies value is stored and a DataQualityIssue records the original
 * value and the override. Policies that do not govern an Option 2 field
 * are left unused.
 */

const DELIVERY_POLICY_KEY = "delivery";

export type PolicyOverride = {
  listingId: string;
  row: number;
  field: "deliveryDays";
  original: number;
  override: number;
};

export function planPolicyOverrides(
  rules: readonly { key: string; value: string }[],
  listings: readonly { listingId: string; deliveryDays: number; row: number }[],
): PolicyOverride[] {
  const rule = rules.find((entry) => entry.key.trim().toLowerCase() === DELIVERY_POLICY_KEY);
  if (!rule) return [];
  const trimmed = rule.value.trim();
  if (!/^-?\d+$/.test(trimmed)) return [];
  const override = Number(trimmed);

  const planned: PolicyOverride[] = [];
  for (const listing of listings) {
    if (!listing.listingId || listing.deliveryDays === override) continue;
    planned.push({
      listingId: listing.listingId,
      row: listing.row,
      field: "deliveryDays",
      original: listing.deliveryDays,
      override,
    });
  }
  return planned;
}

/** Apply delivery-policy overrides after sheets are loaded and an import run exists. */
export async function applyPolicyPrecedence(
  db: PrismaClient,
  sheets: Record<string, SheetRows>,
): Promise<number> {
  const rules = (sheets.Policies ?? []).map((row) => ({
    key: str(row, "key", "Key"),
    value: str(row, "value", "Value"),
  }));
  const listings = (sheets.Listings ?? []).map((row, index) => ({
    listingId: str(row, "listingId", "ListingId"),
    deliveryDays: num(row, "deliveryDays", "DeliveryDays"),
    row: index + 2,
  }));
  const overrides = planPolicyOverrides(rules, listings);
  if (overrides.length === 0) return 0;

  const run = await db.importRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!run) {
    throw new Error("Policy precedence requires an import run");
  }

  for (const override of overrides) {
    await db.listing.update({
      where: { listingId: override.listingId },
      data: { deliveryDays: override.override },
    });
    await db.dataQualityIssue.create({
      data: {
        id: randomUUID(),
        importRunId: run.id,
        tab: "Listings",
        row: override.row,
        issueType: "policy_override",
        detail: `listing ${override.listingId} deliveryDays original:${override.original}`,
        handling: `stored Policies value override:${override.override}`,
      },
    });
  }
  return overrides.length;
}
