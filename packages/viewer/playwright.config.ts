import { defineConfig, devices } from "@playwright/test";

/** The browser tests of the viewer run against the production build, on port 5299. Another app uses port 5199. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:5299/", viewport: { width: 1400, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 5299 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5299/",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 120_000,
  },
});
