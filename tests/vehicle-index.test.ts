import { describe, expect, it } from "vitest";
import {
  buildVehicleIndex,
  isMissingVehicleTable,
  loadVehicleIndexes,
  resolveQuery,
  type VehicleRecord,
} from "../src/api/query/vehicle-index";

const w205C200: VehicleRecord = {
  vehicleId: "veh-c200",
  make: "Mercedes",
  model: "C200",
  chassisCode: "W205",
  chassisCodeNorm: "w205",
  yearFrom: 2014,
  yearTo: 2018,
};

const w205C300: VehicleRecord = {
  vehicleId: "veh-c300",
  make: "Mercedes",
  model: "C300",
  chassisCode: "W205",
  chassisCodeNorm: "w205",
  yearFrom: 2015,
  yearTo: 2021,
};

const w204: VehicleRecord = {
  vehicleId: "veh-w204",
  make: "Mercedes",
  model: "C180",
  chassisCode: "W204",
  chassisCodeNorm: "w204",
  yearFrom: 2007,
  yearTo: 2014,
};

describe("vehicle indexes", () => {
  it("maps chassis codes, makes to models, and make-model year ranges", () => {
    const index = buildVehicleIndex([w205C200, w205C300, w204]);

    expect(index.chassisToVehicleIds.get("w205")).toEqual(["veh-c200", "veh-c300"]);
    expect(index.chassisToVehicleIds.get("w204")).toEqual(["veh-w204"]);
    expect([...(index.makeToModels.get("mercedes") ?? [])].sort()).toEqual(["c180", "c200", "c300"]);
    expect(index.makeModelYearRanges.get("mercedes\0c200")).toEqual([
      { vehicleId: "veh-c200", yearFrom: 2014, yearTo: 2018 },
    ]);
  });

  it("normalises a chassis code to lower-case alphanumerics", () => {
    const index = buildVehicleIndex([{ ...w205C200, chassisCodeNorm: "W-205" }]);
    expect(index.chassisToVehicleIds.get("w205")).toEqual(["veh-c200"]);
  });
});

describe("resolve vehicles", () => {
  it("resolves w205 in 'w205 pads' and removes it from the part terms", () => {
    loadVehicleIndexes([w205C200]);

    const result = resolveQuery("w205 pads");

    expect(result.vehicleIds).toEqual(["veh-c200"]);
    expect(result.active).toEqual({ vehicleId: "veh-c200", source: "query" });
    expect(result.partTerms).toEqual(["pads"]);
    expect(result.partTerms).not.toContain("w205");
  });

  it("returns every matching id and chooses none when several vehicles match", () => {
    loadVehicleIndexes([w205C200, w205C300, w204]);

    const result = resolveQuery("w205 pads");

    expect(result.vehicleIds).toEqual(["veh-c200", "veh-c300"]);
    expect(result.active).toBeNull();
    expect(result.partTerms).toEqual(["pads"]);
  });

  it("matches a chassis token that differs only by case or punctuation", () => {
    loadVehicleIndexes([w205C200]);

    expect(resolveQuery("W205 pads").vehicleIds).toEqual(["veh-c200"]);
    expect(resolveQuery("W-205 pads").partTerms).toEqual(["pads"]);
  });

  it("resolves make, model and a year inside the vehicle year range", () => {
    loadVehicleIndexes([w205C200, w205C300]);

    const result = resolveQuery("Mercedes C200 2016 pads");

    expect(result.vehicleIds).toEqual(["veh-c200"]);
    expect(result.active).toEqual({ vehicleId: "veh-c200", source: "query" });
    expect(result.partTerms).toEqual(["pads"]);
  });

  it("returns every make, model and year match and chooses none", () => {
    const shared: VehicleRecord = { ...w205C300, model: "C200", vehicleId: "veh-c200-late", yearFrom: 2016, yearTo: 2018 };
    loadVehicleIndexes([w205C200, shared]);

    const result = resolveQuery("mercedes c200 2016 brake disc");

    expect(result.vehicleIds).toEqual(["veh-c200", "veh-c200-late"]);
    expect(result.active).toBeNull();
    expect(result.partTerms).toEqual(["brake", "disc"]);
  });

  it("leaves the query unchanged when the year is outside every range", () => {
    loadVehicleIndexes([w205C200]);

    const result = resolveQuery("Mercedes C200 2024 pads");

    expect(result.vehicleIds).toEqual([]);
    expect(result.active).toBeNull();
    expect(result.partTerms).toEqual(["Mercedes", "C200", "2024", "pads"]);
  });

  it("keeps an explicit buyer selection instead of choosing a query match", () => {
    loadVehicleIndexes([w205C200, w205C300]);

    const result = resolveQuery("w205 pads", { explicitVehicleId: "veh-c300" });

    expect(result.vehicleIds).toEqual(["veh-c200", "veh-c300"]);
    expect(result.active).toEqual({ vehicleId: "veh-c300", source: "explicit" });
    expect(result.partTerms).toEqual(["pads"]);
  });
});

describe("isMissingVehicleTable", () => {
  it("recognises a missing Vehicle relation", () => {
    const error = new Error('relation "Vehicle" does not exist');
    expect(isMissingVehicleTable(error)).toBe(true);
    expect(isMissingVehicleTable(new Error("connection refused"))).toBe(false);
  });
});
