import type { Prisma } from "../../src/generated/prisma/client";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { bool, num, str, type SheetRows } from "./workbook";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Truncate importable tables (children first). Derived tables cleared so reloads stay empty until U-9. */
export async function truncateImportTables(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "BasketItem", "Basket", "AdvisorSession",
      "LatencySample", "EvalRun",
      "DataQualityIssue", "ImportRun",
      "Fitment", "Listing", "VinDecode",
      "PartNumberAlias", "VocabularyTerm",
      "CatalogueSku", "Vehicle", "Seller",
      "OrderLine", "SearchLog", "SearchEval",
      "PolicyRule", "SystemStandIn"
    RESTART IDENTITY CASCADE
  `);
}

export async function loadSheets(db: PrismaClient, sheets: Record<string, SheetRows>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const vehicles = sheets.Vehicles ?? [];
  if (vehicles.length) {
    await db.vehicle.createMany({
      data: vehicles.map((r) => {
        const chassisCode = str(r, "chassisCode", "ChassisCode", "chassis");
        return {
          vehicleId: str(r, "vehicleId", "VehicleId", "id"),
          make: str(r, "make", "Make"),
          model: str(r, "model", "Model"),
          chassisCode,
          chassisCodeNorm: chassisCode.toLowerCase().replace(/[^a-z0-9]/g, ""),
          yearFrom: num(r, "yearFrom", "YearFrom"),
          yearTo: num(r, "yearTo", "YearTo"),
          populationByEmirate: asJson(r.populationByEmirate ?? {}),
        };
      }),
    });
  }
  counts.Vehicles = vehicles.length;

  const catalogue = sheets.Catalogue ?? [];
  if (catalogue.length) {
    await db.catalogueSku.createMany({
      data: catalogue.map((r) => {
        const partNumber = str(r, "partNumber", "PartNumber", "part_number");
        return {
          sku: str(r, "sku", "SKU"),
          partNumber,
          // Derived normalisation is U-9; store raw part number so the NOT NULL column is filled.
          partNumberNorm: partNumber,
          nameEn: str(r, "nameEn", "NameEn", "name_en", "name"),
          category: str(r, "category", "Category") || null,
          brand: str(r, "brand", "Brand") || null,
          fitmentSummary: str(r, "fitmentSummary", "FitmentSummary") || null,
          completeness: num(r, "completeness", "Completeness"),
          hasFitmentRecord: false,
          qualityFlags: {},
        };
      }),
    });
  }
  counts.Catalogue = catalogue.length;

  const sellers = sheets.Sellers ?? [];
  if (sellers.length) {
    await db.seller.createMany({
      data: sellers.map((r) => {
        const makes = str(r, "specialistMakes", "SpecialistMakes");
        return {
          sellerId: str(r, "sellerId", "SellerId"),
          name: str(r, "name", "Name"),
          type: str(r, "type", "Type"),
          emirate: str(r, "emirate", "Emirate"),
          specialistMakes: makes ? makes.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
          rating: num(r, "rating", "Rating"),
        };
      }),
    });
  }
  counts.Sellers = sellers.length;

  const listings = sheets.Listings ?? [];
  if (listings.length) {
    await db.listing.createMany({
      data: listings.map((r) => ({
        listingId: str(r, "listingId", "ListingId"),
        sku: str(r, "sku", "SKU"),
        sellerId: str(r, "sellerId", "SellerId"),
        condition: str(r, "condition", "Condition"),
        price: num(r, "price", "Price"),
        stock: num(r, "stock", "Stock"),
        warranty: str(r, "warranty", "Warranty"),
        deliveryDays: num(r, "deliveryDays", "DeliveryDays"),
        recentSales: num(r, "recentSales", "RecentSales"),
        excludedFromRanking: bool(r, "excludedFromRanking", "ExcludedFromRanking"),
      })),
    });
  }
  counts.Listings = listings.length;

  const fitment = sheets.Fitment ?? [];
  if (fitment.length) {
    await db.fitment.createMany({
      data: fitment.map((r) => ({
        sku: str(r, "sku", "SKU"),
        vehicleId: str(r, "vehicleId", "VehicleId"),
        raw: asJson(r),
      })),
    });
  }
  counts.Fitment = fitment.length;

  const vins = sheets.VIN_Decode ?? [];
  if (vins.length) {
    await db.vinDecode.createMany({
      data: vins.map((r) => ({
        vin: str(r, "vin", "VIN").toUpperCase(),
        make: str(r, "make", "Make"),
        model: str(r, "model", "Model"),
        chassis: str(r, "chassis", "Chassis"),
        year: num(r, "year", "Year"),
        vehicleId: null,
      })),
    });
  }
  counts.VIN_Decode = vins.length;

  const orders = sheets.Orders ?? [];
  if (orders.length) {
    await db.orderLine.createMany({
      data: orders.map((r) => {
        const od = r.orderDate ?? r.OrderDate;
        return {
          orderLineId: str(r, "orderLineId", "OrderLineId"),
          sku: str(r, "sku", "SKU"),
          status: str(r, "status", "Status"),
          courier: str(r, "courier", "Courier"),
          paymentMethod: str(r, "paymentMethod", "PaymentMethod"),
          returned: bool(r, "returned", "Returned"),
          orderDate: od instanceof Date ? od : new Date(String(od || Date.now())),
        };
      }),
    });
  }
  counts.Orders = orders.length;

  const logs = sheets.Search_Log ?? [];
  if (logs.length) {
    await db.searchLog.createMany({
      data: logs.map((r) => {
        const at = r.searchedAt ?? r.SearchedAt;
        return {
          queryText: str(r, "queryText", "QueryText", "query"),
          todayResultCount: num(r, "todayResultCount", "TodayResultCount"),
          nextAction: str(r, "nextAction", "NextAction"),
          searchedAt: at instanceof Date ? at : new Date(String(at || Date.now())),
        };
      }),
    });
  }
  counts.Search_Log = logs.length;

  const evals = sheets.Search_Eval ?? [];
  if (evals.length) {
    await db.searchEval.createMany({
      data: evals.map((r) => {
        const raw = str(r, "expectedSkus", "ExpectedSkus");
        return {
          queryText: str(r, "queryText", "QueryText", "query"),
          expectedSkus: raw ? raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
        };
      }),
    });
  }
  counts.Search_Eval = evals.length;

  const policies = sheets.Policies ?? [];
  if (policies.length) {
    await db.policyRule.createMany({
      data: policies.map((r, i) => ({
        key: str(r, "key", "Key"),
        value: str(r, "value", "Value"),
        sourceRow: num(r, "sourceRow", "SourceRow") || i + 2,
      })),
    });
  }
  counts.Policies = policies.length;

  const systems = sheets.Systems ?? [];
  if (systems.length) {
    await db.systemStandIn.createMany({
      data: systems.map((r) => ({
        systemName: str(r, "systemName", "SystemName", "system"),
        holds: str(r, "holds", "Holds"),
        standInTab: str(r, "standInTab", "StandInTab", "stand_in_tab"),
      })),
    });
  }
  counts.Systems = systems.length;

  return counts;
}
