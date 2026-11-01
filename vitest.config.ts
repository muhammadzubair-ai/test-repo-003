import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Import tests share one local Postgres; run files sequentially.
    fileParallelism: false,
  },
});
