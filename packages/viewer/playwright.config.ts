import { defineConfig, devices } from "@playwright/test";

/** The browser tests of the viewer run against the production build, on port 5299. Another app uses port 5199. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Locally, more workers start more browsers at once, and Firefox then starts too slowly. CI keeps the default.
  ...(process.env["CI"] === undefined ? { workers: 4 } : {}),
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:5299/", viewport: { width: 1400, height: 900 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } }, testIgnore: /touch\.spec/u },
    // Firefox and WebKit start slowly when many workers start them at once, thus their first test can take longer
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1400, height: 900 } }, testIgnore: /touch\.spec/u, timeout: 60_000 },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1400, height: 900 } }, testIgnore: /touch\.spec/u, timeout: 60_000 },
    // The touch screens: a phone with WebKit, and a phone with Chromium. Their tests tap and do not drag.
    { name: "phone-webkit", use: { ...devices["iPhone 15"] }, testMatch: /touch\.spec/u },
    { name: "phone-chromium", use: { ...devices["Pixel 7"] }, testMatch: /touch\.spec/u },
  ],
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 5299 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5299/",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 120_000,
  },
});
