import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const dist = fileURLToPath(new URL("../dist", import.meta.url));

/** This function gives each route of the build: each folder with an index.html. */
function routes(dir: string = dist): readonly string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name.startsWith("_") || name === "pagefind") continue;
      out.push(...routes(p));
    } else if (name === "index.html") {
      out.push(relative(dist, dir).replaceAll("\\", "/"));
    }
  }
  return out;
}

/** This function scrolls a widget into view and waits until its island has hydrated. */
async function hydrated(region: ReturnType<Page["getByRole"]>): Promise<void> {
  await region.scrollIntoViewIfNeeded();
  // Astro removes the attribute "ssr" from an island when the island hydrates.
  await expect(region.locator("xpath=ancestor::astro-island[1]")).not.toHaveAttribute("ssr", /.*/);
}

/** This function collects the console errors and the page errors of a page. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page: ${e.message}`));
  return problems;
}

for (const route of routes()) {
  test(`the page /${route} renders without errors`, async ({ page }) => {
    const problems = watch(page);
    await page.goto(route === "" ? "./" : `./${route}/`);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
}

test("the epoch explorer shows the order of an epoch and its pruning", async ({ page }) => {
  await page.goto("./");
  const explorer = page.getByRole("region", { name: "One write, one epoch" });
  await hydrated(explorer);
  await explorer.getByRole("button", { name: /a = -3/ }).click();
  await expect(explorer.getByText("The epoch evaluated 4 of 5 nodes")).toBeVisible();
  // abs(a) did not change, thus the epoch did not evaluate c
  await expect(explorer.locator('[data-node="c"]')).toHaveAttribute("data-state", "idle");
  await expect(explorer.locator('[data-node="b"]')).toHaveAttribute("data-state", "evaluated");
  await expect(explorer.locator('[data-node="d"]')).toHaveAttribute("data-state", "changed");
});

test("the playground evaluates an expression and explains a none", async ({ page }) => {
  await page.goto("./learn/expressions/");
  const playground = page.getByRole("region", { name: "The expression playground" });
  await hydrated(playground);
  await expect(playground.getByText("some(9)")).toBeVisible();
  await playground.getByRole("button", { name: "a missing path" }).click();
  await expect(playground.getByRole("list", { name: "issues" })).toContainText("path-miss: box.width");
});

test("the instances follow the class until they have their own value", async ({ page }) => {
  await page.goto("./learn/classes/");
  const demo = page.getByRole("region", { name: "A class and three instances" });
  await hydrated(demo);
  await demo.getByLabel("the label of instance B").fill("mine");
  await demo.getByLabel("the label of the class").fill("planet");
  await expect(demo.locator('[data-instance="A"] [data-cell="text"]')).toHaveText('"planet × 1"');
  await expect(demo.locator('[data-instance="B"] [data-cell="text"]')).toHaveText('"mine × 1"');
});

test("the viewer in the site makes an instance from a drop", async ({ page }) => {
  const problems = watch(page);
  await page.goto("./viewer/");
  const viewer = page.getByRole("application", { name: "The render viewer" });
  const chip = viewer.locator('.rv-packed-container .rv-class-name.rv-draggable:text-is("Text")').first();
  await expect(chip).toBeVisible();
  await chip.dragTo(viewer.locator(".panel-canvas .panel-body"));
  await expect(viewer.locator(".canvas-item")).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("the review shows a passing chip for each defect when the build has a test report", async ({ page }) => {
  await page.goto("./design/review/");
  const total = await page.locator(".rd-chip").count();
  expect(total).toBeGreaterThan(0);
  const unknown = await page.locator('.rd-chip[data-state="unknown"]').count();
  const failing = await page.locator('.rd-chip[data-state="fail"]').count();
  expect(failing).toBe(0);
  // A build without a report (a local build) shows each chip as unknown
  expect([0, total]).toContain(unknown);
});
