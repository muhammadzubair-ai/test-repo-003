import { connection } from "next/server";
import { db } from "@/lib/db";
import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection();
  const health = await checkHealth(() => db.$queryRaw`SELECT 1`);
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
