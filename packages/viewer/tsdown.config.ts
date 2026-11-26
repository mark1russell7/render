import { defineConfig } from "tsdown";

// The build of the package for npm: one ES module and its declarations in build/. The workspace uses the source.
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "build",
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  // The style sheet ships next to the module: the published export ./styles.css points at build/styles.css
  copy: "src/styles.css",
  publint: true,
  // The style sheet has no types, thus the type check skips it
  attw: { profile: "esm-only", excludeEntrypoints: ["./styles.css"] },
});
