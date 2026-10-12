import { defineConfig, devices } from "@playwright/test";

/** The smoke tests of the site run against the built site, at the base path of GitHub Pages. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Locally, more workers start more browsers at once, and Firefox then starts too slowly. CI keeps the default.
  ...(process.env["CI"] === undefined ? { workers: 4 } : {}),
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:4331/render/" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Firefox and WebKit start slowly when many workers start them at once, thus their first test can take longer
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, timeout: 60_000 },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, timeout: 60_000 },
    // A phone with WebKit: each page fits the width of the screen, and the viewer works without a drag
    { name: "phone-webkit", use: { ...devices["iPhone 15"] }, timeout: 60_000 },
  ],
  webServer: {
    command: "pnpm exec astro preview --port 4331 --host 127.0.0.1",
    url: "http://127.0.0.1:4331/render/",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 60_000,
    env: { ASTRO_TELEMETRY_DISABLED: "1" },
  },
});
