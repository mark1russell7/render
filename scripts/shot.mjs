// Playwright verification driver for the render viewer.
// Usage: node scripts/shot.mjs <scenario> [outDir]
// Assumes a vite dev server for @render/viewer on http://localhost:5199.
// Each scenario performs UI actions, screenshots along the way, and prints
// PASS/FAIL lines plus any browser console errors.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const scenario = process.argv[2] ?? "baseline";
const outDir = process.argv[3] ?? "shots";
mkdirSync(outDir, { recursive: true });

const URL = "http://localhost:5299";
const errors = [];
let shotIndex = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

const shot = async (name) => {
  shotIndex++;
  const file = join(outDir, `${scenario}-${String(shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`SHOT ${file}`);
};

const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};

// Drag a class name from the type graph onto the canvas.
const dragClassToCanvas = async (className) => {
  const source = page.locator(`.rv-draggable:text-is("${className}")`).first();
  const target = page.locator(".panel-canvas .panel-body");
  await source.dragTo(target);
  await page.waitForTimeout(200);
};

// Click the value of the Nth canvas item and type a new value.
const editCanvasText = async (itemIndex, text) => {
  const item = page.locator(".canvas-item").nth(itemIndex);
  await item.locator(".rv-text.rv-clickable").first().click();
  const input = item.locator("input.rv-editing").first();
  await input.fill(text);
  await input.press("Enter");
  await page.waitForTimeout(300);
};

const canvasItemText = async (itemIndex) =>
  await page.locator(".canvas-item").nth(itemIndex).locator(".rv-text").first().textContent();

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

switch (scenario) {
  case "baseline": {
    await shot("initial");
    const hasTypePanel = await page.locator(".panel-types").count();
    const hasCanvas = await page.locator(".panel-canvas").count();
    check("type graph panel renders", hasTypePanel === 1);
    check("canvas panel renders", hasCanvas === 1);
    const classCount = await page.locator(".rv-packed-item").count();
    check(`packed class cards present (${classCount})`, classCount > 5);
    break;
  }

  case "edit-persist": {
    // The P0-1 regression: edit a canvas Text, then drop another class
    // (which triggers store-wide re-resolution) — the edit must survive.
    await dragClassToCanvas("Text");
    await shot("after-drop-text");
    await editCanvasText(0, "hello world");
    await shot("after-edit");
    const v1 = await canvasItemText(0);
    check(`edit applied (got "${v1}")`, v1 === "hello world");
    await dragClassToCanvas("Num");
    await shot("after-second-drop");
    const v2 = await canvasItemText(0);
    check(`edit survived second drop (got "${v2}")`, v2 === "hello world");
    break;
  }

  default:
    console.error(`unknown scenario: ${scenario}`);
    process.exitCode = 1;
}

if (errors.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of errors) console.log("  " + e.split("\n")[0]);
} else {
  console.log("NO CONSOLE ERRORS");
}

await browser.close();
