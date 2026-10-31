import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { checkHealth } from "@/lib/health";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">It works</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        A Next.js, TypeScript, Prisma and Postgres skeleton. Replace this page with the first feature.
      </p>
      <Suspense fallback={<p className="mt-8 text-sm text-neutral-500">Checking the database…</p>}>
        <DatabaseStatus />
      </Suspense>
    </main>
  );
}

async function DatabaseStatus() {
  await connection();
  const health = await checkHealth(() => db.$queryRaw`SELECT 1`);
  return (
    <p className="mt-8 text-sm" data-testid="database-status">
      Database: <strong>{health.database}</strong>
    </p>
  );
}
