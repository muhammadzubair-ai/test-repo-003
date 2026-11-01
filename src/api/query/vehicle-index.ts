/**
 * Chassis-code and vehicle resolver (ARCH-7).
 *
 * Indexes are built from Vehicle rows and kept in memory. A token equal to a
 * chassis code (lower case, alphanumerics only), or a make, model and
 * four-digit year together, resolves to every matching vehicle. The matched
 * tokens are removed from the part terms. When several vehicles match, every
 * id is returned and none is chosen.
 */

export type VehicleRecord = {
  vehicleId: string;
  make: string;
  model: string;
  chassisCode: string;
  chassisCodeNorm: string;
  yearFrom: number;
  yearTo: number;
};

export type YearRange = {
  vehicleId: string;
  yearFrom: number;
  yearTo: number;
};

export type VehicleIndex = {
  /** chassisCodeNorm → vehicle ids, in load order. */
  chassisToVehicleIds: Map<string, string[]>;
  /** Lower-case make → lower-case models. */
  makeToModels: Map<string, Set<string>>;
  /** `${make}\0${model}` → year ranges for that make and model. */
  makeModelYearRanges: Map<string, YearRange[]>;
};

export type ActiveVehicle = {
  vehicleId: string;
  source: "query" | "explicit";
};

export type VehicleResolution = {
  /** Every match. The resolver does not drop ids to force a single choice. */
  vehicleIds: string[];
  /** Set when exactly one vehicle matched, or when the buyer already chose. */
  active: ActiveVehicle | null;
  /** Query tokens that were not consumed by resolution. */
  partTerms: string[];
};

export type ResolveOptions = {
  /** Buyer selected this vehicle; do not replace it with a query match. */
  explicitVehicleId?: string | null;
};

const MAKE_MODEL_SEP = "\0";

/** ARCH-7: lower case, alphanumerics only. */
export function normalizeChassisCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function makeModelKey(make: string, model: string): string {
  return `${make.toLowerCase()}${MAKE_MODEL_SEP}${model.toLowerCase()}`;
}

function uniquePush(ids: string[], vehicleId: string): void {
  if (!ids.includes(vehicleId)) ids.push(vehicleId);
}

export function emptyVehicleIndex(): VehicleIndex {
  return {
    chassisToVehicleIds: new Map(),
    makeToModels: new Map(),
    makeModelYearRanges: new Map(),
  };
}

export function buildVehicleIndex(vehicles: readonly VehicleRecord[]): VehicleIndex {
  const index = emptyVehicleIndex();

  for (const vehicle of vehicles) {
    const chassis = normalizeChassisCode(vehicle.chassisCodeNorm || vehicle.chassisCode);
    if (chassis) {
      const ids = index.chassisToVehicleIds.get(chassis) ?? [];
      uniquePush(ids, vehicle.vehicleId);
      index.chassisToVehicleIds.set(chassis, ids);
    }

    const make = vehicle.make.trim().toLowerCase();
    const model = vehicle.model.trim().toLowerCase();
    if (!make || !model) continue;

    const models = index.makeToModels.get(make) ?? new Set<string>();
    models.add(model);
    index.makeToModels.set(make, models);

    const key = makeModelKey(make, model);
    const ranges = index.makeModelYearRanges.get(key) ?? [];
    ranges.push({
      vehicleId: vehicle.vehicleId,
      yearFrom: Number(vehicle.yearFrom),
      yearTo: Number(vehicle.yearTo),
    });
    index.makeModelYearRanges.set(key, ranges);
  }

  return index;
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter((token) => token.length > 0);
}

function resolveChassis(tokens: string[], index: VehicleIndex): { vehicleIds: string[]; consumed: Set<number> } {
  const vehicleIds: string[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < tokens.length; i++) {
    const chassis = normalizeChassisCode(tokens[i]);
    if (!chassis) continue;
    const ids = index.chassisToVehicleIds.get(chassis);
    if (!ids || ids.length === 0) continue;
    consumed.add(i);
    for (const id of ids) uniquePush(vehicleIds, id);
  }

  return { vehicleIds, consumed };
}

function resolveMakeModelYear(
  tokens: string[],
  index: VehicleIndex,
): { vehicleIds: string[]; consumed: Set<number> } {
  const consumed = new Set<number>();
  const vehicleIds: string[] = [];

  for (let makeAt = 0; makeAt < tokens.length; makeAt++) {
    const make = tokens[makeAt].toLowerCase();
    const models = index.makeToModels.get(make);
    if (!models) continue;

    for (let modelAt = 0; modelAt < tokens.length; modelAt++) {
      if (modelAt === makeAt) continue;
      const model = tokens[modelAt].toLowerCase();
      if (!models.has(model)) continue;

      for (let yearAt = 0; yearAt < tokens.length; yearAt++) {
        if (yearAt === makeAt || yearAt === modelAt) continue;
        if (!/^\d{4}$/.test(tokens[yearAt])) continue;
        const year = Number(tokens[yearAt]);
        const ranges = index.makeModelYearRanges.get(makeModelKey(make, model)) ?? [];
        for (const range of ranges) {
          if (year >= range.yearFrom && year <= range.yearTo) uniquePush(vehicleIds, range.vehicleId);
        }
        if (vehicleIds.length === 0) continue;
        consumed.add(makeAt);
        consumed.add(modelAt);
        consumed.add(yearAt);
        return { vehicleIds, consumed };
      }
    }
  }

  return { vehicleIds, consumed };
}

export function resolveVehicles(
  query: string,
  index: VehicleIndex,
  options: ResolveOptions = {},
): VehicleResolution {
  const tokens = tokenize(query);
  const chassis = resolveChassis(tokens, index);
  const matched = chassis.vehicleIds.length > 0 ? chassis : resolveMakeModelYear(tokens, index);
  const partTerms = tokens.filter((_, tokenIndex) => !matched.consumed.has(tokenIndex));
  const explicit = options.explicitVehicleId?.trim() || null;

  if (explicit) {
    return {
      vehicleIds: matched.vehicleIds,
      active: { vehicleId: explicit, source: "explicit" },
      partTerms,
    };
  }

  if (matched.vehicleIds.length === 1) {
    return {
      vehicleIds: matched.vehicleIds,
      active: { vehicleId: matched.vehicleIds[0], source: "query" },
      partTerms,
    };
  }

  return { vehicleIds: matched.vehicleIds, active: null, partTerms };
}

let loadedIndex = emptyVehicleIndex();

/** Replace the in-memory indexes. Called at server start with Vehicle rows. */
export function loadVehicleIndexes(vehicles: readonly VehicleRecord[]): VehicleIndex {
  loadedIndex = buildVehicleIndex(vehicles);
  return loadedIndex;
}

export function getVehicleIndex(): VehicleIndex {
  return loadedIndex;
}

/** Resolve against the indexes loaded at server start. */
export function resolveQuery(query: string, options?: ResolveOptions): VehicleResolution {
  return resolveVehicles(query, loadedIndex, options);
}

/**
 * True when Postgres has no Vehicle relation yet. The catalogue schema is
 * owned by an earlier unit and is not always migrated on this branch.
 */
export function isMissingVehicleTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("42P01") || /relation ["']?Vehicle["']? does not exist/i.test(message);
}
