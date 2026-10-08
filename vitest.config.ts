import { defineConfig } from "vitest/config";

// The coverage run of the workspace: the tests of each package, with the coverage of the engine packages.
export default defineConfig({
  test: {
    projects: [
      "packages/optional",
      "packages/dsl",
      "packages/node",
      "packages/biblo",
      "packages/splay",
      "packages/pack",
      "packages/seat",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/{optional,dsl,node,biblo,splay,pack,seat}/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.bench.ts", "**/index.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "coverage",
      // The floor of the engine coverage. A run under it fails. Raise it when the coverage grows.
      thresholds: { statements: 95, branches: 87, functions: 98, lines: 97 },
    },
  },
});
