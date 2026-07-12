import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    benchmark: {
      include: ["packages/*/src/**/*.bench.ts"],
    },
  },
});
