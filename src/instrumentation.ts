export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadVehicleIndexesAtServerStart } = await import("./api/query/load-vehicle-index");
  await loadVehicleIndexesAtServerStart();
}
