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
// Scoped to the VISIBLE packed container (a hidden measurement layer
// duplicates every card).
const dragClassToCanvas = async (className) => {
  const source = page.locator(`.rv-packed-container .rv-draggable:text-is("${className}")`).first();
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
    const classCount = await page.locator(".rv-packed-container .rv-packed-item").count();
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

  case "lifecycle": {
    // Data-view toggles must not leak instances/nodes; delete removes the item.
    const nodeTotal = async () => {
      const t = await page.locator(".epoch-stats").textContent();
      return Number(/\/\s*(\d+)\s*nodes/.exec(t ?? "")?.[1] ?? NaN);
    };
    const togglePair = async () => {
      await page.locator(".canvas-item .view-toggle").first().click(); // → data
      await page.waitForTimeout(150);
      await page.locator(".canvas-item .view-toggle").first().click(); // → rendered
      await page.waitForTimeout(150);
    };
    await dragClassToCanvas("Text");
    // Warm-up: first edit grows the class def (cells section appears in the
    // type graph) and the first toggle warms the data-view path. Measure
    // only across the steady-state cycle.
    await editCanvasText(0, "warmup");
    await togglePair();
    await editCanvasText(0, "leakcheck");
    const before = await nodeTotal();
    for (let i = 0; i < 3; i++) await togglePair();
    await editCanvasText(0, "leakcheck2");
    const after = await nodeTotal();
    await shot("after-toggles");
    check(`node total stable across 3 data-view toggle pairs (${before} → ${after})`, after <= before + 5);

    await page.locator(".canvas-item-remove").first().click();
    await page.waitForTimeout(150);
    const items = await page.locator(".canvas-item").count();
    await shot("after-delete");
    check("canvas item removed by × button", items === 0);
    break;
  }

  case "expr-editing": {
    // Self-rendering IR: class render methods must appear as expression
    // trees (op(...) chips), not as raw tag/args JSON grids.
    const exprApps = await page.locator(".rv-packed-container .rv-expr-app").count();
    const exprRefs = await page.locator(".rv-packed-container .rv-expr-ref").count();
    await shot("type-graph-expr-trees");
    check(`expression trees render in the type graph (${exprApps} app nodes)`, exprApps > 5);
    check(`ref paths render semantically (${exprRefs} refs)`, exprRefs > 5);
    break;
  }

  case "user-class-drag": {
    // A user-created class must itself be draggable from the type graph.
    await dragClassToCanvas("Text");
    await page.waitForTimeout(300);
    const userChip = page.locator(`.rv-packed-container .rv-draggable:text-is("Text_1")`).first();
    const chipCount = await userChip.count();
    check("user class Text_1 renders as draggable chip", chipCount > 0);
    if (chipCount > 0) {
      await userChip.dragTo(page.locator(".panel-canvas .panel-body"));
      await page.waitForTimeout(300);
    }
    await shot("after-user-class-drag");
    const items = await page.locator(".canvas-item").count();
    check(`second canvas item exists (${items} items)`, items === 2);
    const secondHeader = items >= 2
      ? await page.locator(".canvas-item-header span").nth(1).textContent()
      : null;
    check(`second item is a subclass of Text_1 (got "${secondHeader}")`, (secondHeader ?? "").startsWith("Text_1"));
    break;
  }

  case "search": {
    // The search node IS the filter state — and it survives store-wide
    // re-resolution (a drop) because writes rewrite exprs (Phase 0).
    const box = page.locator(".biblo-search .rv-text").first();
    await box.click();
    const input = page.locator(".biblo-search input.rv-editing").first();
    await input.fill("grid");
    await input.press("Enter");
    await page.waitForTimeout(300);
    const visible = await page.locator(".rv-packed-container .rv-packed-item").count();
    await shot("filtered");
    check(`search filters class cards (${visible} visible)`, visible >= 1 && visible <= 3);

    await dragClassToCanvas("Grid");
    await page.waitForTimeout(300);
    const boxText = await page.locator(".biblo-search .rv-text").first().textContent();
    await shot("after-drop");
    check(`search text survives a drop (got "${boxText}")`, boxText === "grid");
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
