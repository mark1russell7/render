import { defineConfig } from "vitest/config";

// The speed lane. `pnpm bench` runs it, and the nightly workflow keeps the report. No time limit fails it.
// Node runs the TypeScript source as native ESM (type stripping), thus the module runner of Vite adds no getter to each import.
export default defineConfig({
  test: {
    experimental: { viteModuleRunner: false, nodeLoader: false },
    benchmark: { include: ["bench/**/*.bench.ts"] },
  },
});
