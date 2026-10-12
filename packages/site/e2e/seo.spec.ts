import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/** The tags that search engines and share cards read. One browser is enough: the tags are static. */

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

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== "chromium", "The tags are the same in each browser.");
});

for (const route of routes()) {
  test(`the page /${route} has the tags of search and of a share card`, async ({ page }) => {
    await page.goto(route === "" ? "./" : `./${route}/`);
    const meta = async (key: string): Promise<string | null> =>
      page.locator(`meta[name="${key}"], meta[property="${key}"]`).first().getAttribute("content");
    expect((await page.title()).length).toBeGreaterThan(0);
    expect((await meta("description"))?.length ?? 0).toBeGreaterThan(20);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/^https:\/\/mark1russell7\.github\.io\/render\//u);
    expect(await meta("og:image")).toMatch(/^https:\/\/.+\/og\.png$/u);
    expect(await meta("twitter:image")).toMatch(/^https:\/\/.+\/og\.png$/u);
    expect(await meta("og:image:alt")).toBeTruthy();
    expect(await meta("og:title")).toBeTruthy();
  });
}

test("the home page has structured data of the software", async ({ page }) => {
  await page.goto("./");
  const json = await page.locator('script[type="application/ld+json"]').first().textContent();
  const types: unknown = JSON.parse(json ?? "{}");
  expect(JSON.stringify(types)).toMatch(/"@type":"WebSite".*"@type":"SoftwareSourceCode"/u);
});

test("the share card, the manifest, the icons and llms.txt are served", async ({ request }) => {
  const card = await request.get("./og.png");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toContain("image/png");
  const manifest = await (await request.get("./site.webmanifest")).text();
  const icons = [...manifest.matchAll(/"src": "([^"]+)"/gu)].map((m) => m[1] ?? "");
  expect(icons.length).toBeGreaterThan(2);
  const statuses = await Promise.all(icons.map(async (src) => (await request.get(src)).status()));
  expect(statuses.every((s) => s === 200)).toBe(true);
  expect((await request.get("./apple-touch-icon.png")).status()).toBe(200);
  expect(await (await request.get("./llms.txt")).text()).toContain("@mark1russell7/render-node");
  expect((await request.get("./sitemap-index.xml")).status()).toBe(200);
});
