import { db } from "@/lib/db";
import { isMissingVehicleTable, loadVehicleIndexes, type VehicleRecord } from "./vehicle-index";

/** Load Vehicle rows into the in-memory indexes. Used from server start. */
export async function loadVehicleIndexesAtServerStart(): Promise<void> {
  try {
    const rows = await db.$queryRaw<VehicleRecord[]>`
      SELECT "vehicleId", "make", "model", "chassisCode", "chassisCodeNorm", "yearFrom", "yearTo"
      FROM "Vehicle"
    `;
    loadVehicleIndexes(rows);
  } catch (error) {
    if (isMissingVehicleTable(error)) {
      loadVehicleIndexes([]);
      return;
    }
    throw error;
  }
}
