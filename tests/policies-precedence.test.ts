import { describe, expect, it } from "vitest";
import { planPolicyOverrides } from "../infra/import/policies";

describe("planPolicyOverrides", () => {
  const rules = [
    { key: "Delivery", value: "2" },
    { key: "commission", value: "10" },
  ];

  it("plans a delivery override when the listing disagrees", () => {
    const planned = planPolicyOverrides(rules, [
      { listingId: "L1", deliveryDays: 5, row: 2 },
      { listingId: "L2", deliveryDays: 2, row: 3 },
    ]);

    expect(planned).toEqual([
      { listingId: "L1", row: 2, field: "deliveryDays", original: 5, override: 2 },
    ]);
  });

  it("ignores policies that do not govern an Option 2 field", () => {
    const planned = planPolicyOverrides([{ key: "commission", value: "10" }], [
      { listingId: "L1", deliveryDays: 5, row: 2 },
    ]);
    expect(planned).toEqual([]);
  });

  it("ignores a delivery rule that is not an integer day count", () => {
    const planned = planPolicyOverrides([{ key: "Delivery", value: "two days" }], [
      { listingId: "L1", deliveryDays: 5, row: 2 },
    ]);
    expect(planned).toEqual([]);
  });
});
