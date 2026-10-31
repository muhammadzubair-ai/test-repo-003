import "dotenv/config";
import { defineConfig } from "prisma/config";

// Without DATABASE_URL (a fresh clone, CI steps that only generate the client)
// it falls back to the local database from compose.yml.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app" },
});
