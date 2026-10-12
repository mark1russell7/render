import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The tests of a touch screen. A phone has no hover and no drag, thus each flow here uses only taps and the
 * menus. The projects `phone-webkit` and `phone-chromium` run this file.
 */

const item = (page: Page, i: number): Locator => page.locator(".canvas-item").nth(i);

const addToCanvas = async (page: Page, name: string): Promise<void> => {
  const before = await page.locator(".canvas-item").count();
  await page.getByLabel("add a class to the canvas").selectOption(name);
  await expect(page.locator(".canvas-item")).toHaveCount(before + 1);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rv-packed-container .rv-packed-item").first()).toBeVisible();
});

test("R-51: the page has no horizontal scroll on a phone", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await addToCanvas(page, "VStack");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/** This helper taps a child of a stack beside its content, thus the tap starts no edit. */
const tapChild = async (child: Locator): Promise<void> => {
  const box = await child.boundingBox();
  if (box === null) throw new Error("the child is not visible");
  await child.tap({ position: { x: box.width * 0.75, y: box.height / 2 } });
};

test("R-51: a tap on a child shows its controls, and their taps add, move and remove a child", async ({ page }) => {
  await addToCanvas(page, "VStack");
  const stack = item(page, 0);
  // Without a hover, the add menu of an empty container shows
  const add = stack.getByLabel("add a child");
  await expect(add).toHaveCSS("opacity", "1");
  await add.selectOption("Num");
  const children = stack.locator(".rv-child");
  await expect(children).toHaveCount(1);

  // A tap gives the focus to the child, thus its controls show. The last child has the add menu of the stack.
  const tools = children.first().locator("> .rv-child-tools");
  await expect(tools).toHaveCSS("opacity", "0");
  await tapChild(children.first());
  await expect(tools).toHaveCSS("opacity", "1");
  await tools.getByLabel("add a child").selectOption("Bool");
  await expect(children).toHaveCount(2);

  await tapChild(children.first());
  await children.first().locator("> .rv-child-tools").getByRole("button", { name: "move child later" }).tap();
  await expect(children.first().locator(".rv-bool-edit")).toHaveCount(1);

  await tapChild(children.nth(1));
  await children.nth(1).locator("> .rv-child-tools").getByRole("button", { name: "remove child" }).tap();
  await expect(children).toHaveCount(1);
  await expect(stack.locator(".rv-num")).toHaveCount(0);
});

test("each control has a target of at least 28 pixels", async ({ page }) => {
  await addToCanvas(page, "VStack");
  await item(page, 0).getByLabel("add a child").first().selectOption("Num");
  const sizes = await page.locator(".rv-child-tool, .rv-disclosure, .view-toggle, .canvas-add").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return Math.min(r.width, r.height);
    }));
  expect(sizes.length).toBeGreaterThan(5);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
});

test("taps switch the data view, undo, and remove an item", async ({ page }) => {
  await addToCanvas(page, "Text");
  await item(page, 0).getByRole("button", { name: "data" }).tap();
  await expect(item(page, 0).getByRole("button", { name: "rendered" })).toBeVisible();
  await page.getByRole("button", { name: "undo" }).tap();
  await expect(item(page, 0).getByRole("button", { name: "data" })).toBeVisible();
  await item(page, 0).getByRole("button", { name: "remove" }).tap();
  await expect(page.locator(".canvas-item")).toHaveCount(0);
});

test("a tap on a text starts its edit", async ({ page }) => {
  await addToCanvas(page, "Text");
  await item(page, 0).locator(".rv-clickable").first().tap();
  const input = item(page, 0).locator("input.rv-editing");
  await expect(input).toBeVisible();
  await input.fill("tapped");
  await input.press("Enter");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("tapped");
});
