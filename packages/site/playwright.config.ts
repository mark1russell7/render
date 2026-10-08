import { defineConfig, devices } from "@playwright/test";

/** The smoke tests of the site run against the built site, at the base path of GitHub Pages. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:4331/render/" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec astro preview --port 4331 --host 127.0.0.1",
    url: "http://127.0.0.1:4331/render/",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 60_000,
    env: { ASTRO_TELEMETRY_DISABLED: "1" },
  },
});
