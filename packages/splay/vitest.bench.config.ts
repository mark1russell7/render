import { defineConfig } from "vitest/config";

// The speed lane. `pnpm bench` runs it, and the nightly workflow keeps the report. No time limit fails it.
export default defineConfig({
  test: {
    benchmark: { include: ["bench/**/*.bench.ts"] },
  },
});
