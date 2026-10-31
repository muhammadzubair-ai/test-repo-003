export type Health = { status: "ok" | "degraded"; database: "up" | "down"; checkedAt: string };

/** The app is up when this runs; it is "ok" when the database answers too. */
export async function checkHealth(pingDatabase: () => Promise<unknown>, now = new Date()): Promise<Health> {
  let database: Health["database"] = "up";
  try {
    await pingDatabase();
  } catch {
    database = "down";
  }
  return { status: database === "up" ? "ok" : "degraded", database, checkedAt: now.toISOString() };
}
