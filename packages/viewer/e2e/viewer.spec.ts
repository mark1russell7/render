import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The page errors and the console errors of a test. Each test expects none. */
const watchErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
};

const chip = (page: Page, name: string) => page.locator(`.rv-packed-container .rv-class-name.rv-draggable:text-is("${name}")`).first();
const item = (page: Page, i: number) => page.locator(".canvas-item").nth(i);

const dropOnCanvas = async (page: Page, name: string): Promise<void> => {
  await expect(chip(page, name)).toBeVisible();
  const before = await page.locator(".canvas-item").count();
  await chip(page, name).dragTo(page.locator(".panel-canvas .panel-body"));
  await expect(page.locator(".canvas-item")).toHaveCount(before + 1);
};

/** This helper selects the level of detail of a panel: "0" to "4", or "all". */
const setDetail = async (page: Page, panel: "type graph" | "canvas", level: string): Promise<void> => {
  await page.getByLabel(`level of detail of the ${panel}`).selectOption({ label: level });
};

const card = (page: Page, name: string) => page.locator(`.rv-packed-container .rv-packed-item[data-class-id="${name}"]`);

const edit = async (scope: ReturnType<Page["locator"]>, text: string, key: "Enter" | "Escape" = "Enter"): Promise<void> => {
  await scope.locator(".rv-clickable").first().click();
  const input = scope.locator("input.rv-editing").first();
  await input.fill(text);
  await input.press(key);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rv-packed-container .rv-packed-item").first()).toBeVisible();
});

test("the type graph shows a card for each class, and the canvas is empty", async ({ page }) => {
  const errors = watchErrors(page);
  expect(await page.locator(".rv-packed-container .rv-packed-item").count()).toBeGreaterThan(10);
  await expect(page.locator(".canvas-empty")).toBeVisible();
  // At the default level, each card shows the boundary of its class: no expression trees
  expect(await page.locator(".rv-packed-container .rv-boundary").count()).toBeGreaterThan(10);
  await expect(page.locator(".rv-packed-container .rv-expr-app")).toHaveCount(0);
  await expect(card(page, "Text").locator(".rv-boundary")).toContainText("cells value");
  // At the full level, the render methods are expression trees, not JSON
  await setDetail(page, "type graph", "all");
  await expect.poll(async () => page.locator(".rv-packed-container .rv-expr-app").count()).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test("ex-P0-1: an edit on the canvas survives a later drop", async ({ page }) => {
  const errors = watchErrors(page);
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "hello world");
  await dropOnCanvas(page, "Num");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("hello world");
  expect(errors).toEqual([]);
});

test("R-27: a text equal to a class name stays editable", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "Grid");
  await expect(item(page, 0).locator(".rv-clickable")).toHaveText("Grid");
  await expect(item(page, 0).locator(".rv-draggable")).toHaveCount(0);
  await edit(item(page, 0), "Grid again");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("Grid again");
});

test("Escape cancels an edit, and an empty number edit keeps the old value (R-28)", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "first");
  await edit(item(page, 0), "discarded", "Escape");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("first");

  await dropOnCanvas(page, "Num");
  await edit(item(page, 1), "5");
  await edit(item(page, 1), "");
  await expect(item(page, 1).locator(".rv-num").first()).toHaveText("5");
});

test("R-29: an edit of a render method in the type graph reaches the canvas", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "42");
  await setDetail(page, "type graph", "all");
  const textCard = card(page, "Text");
  // The first textView of the card is the render method (the summary is the second one)
  await textCard.locator('.rv-expr-op.rv-clickable:text-is("textView(")').first().click();
  const input = textCard.locator("input.rv-editing").first();
  await input.fill("numView");
  await input.press("Enter");
  await expect(item(page, 0).locator(".rv-num")).toHaveText("42");
});

test("R-30: the data view shows the value of the item, and an edit in it goes back to the item", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "orig");
  await item(page, 0).getByRole("button", { name: "data" }).click();
  await expect(item(page, 0)).toContainText("orig");
  await edit(item(page, 0), "from the data view");
  await item(page, 0).getByRole("button", { name: "rendered" }).click();
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("from the data view");
});

test("R-31: a class dropped into the arguments of a method gives a notice, and the viewer stays alive", async ({ page }) => {
  const errors = watchErrors(page);
  // The search shows only the card of Num, thus the drag needs no scroll (a scroll stops an HTML5 drag)
  await edit(page.locator(".biblo-search"), "num");
  await setDetail(page, "type graph", "all");
  const numCard = card(page, "Num");
  await chip(page, "Num").dragTo(numCard.locator(".rv-expr-args").first());
  await expect(page.locator(".rv-notice")).toContainText("not a valid expression");
  await dropOnCanvas(page, "Num");
  await expect(item(page, 0).locator(".rv-num")).toHaveText("0");
  await page.getByRole("button", { name: "dismiss" }).click();
  await expect(page.locator(".rv-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a user class is draggable, and its drop makes a subclass", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await dropOnCanvas(page, "Text_1");
  await expect(page.locator(".canvas-item-header span").nth(1)).toHaveText(/^Text_1_/);
});

test("the search filters the cards and survives a drop", async ({ page }) => {
  await edit(page.locator(".biblo-search"), "grid");
  await expect(page.locator(".rv-packed-container .rv-packed-item")).toHaveCount(1);
  await dropOnCanvas(page, "Grid");
  await expect(page.locator(".biblo-search .rv-text")).toHaveText("grid");
});

test("data-view toggles do not grow the store, and × removes an item", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "x");
  const total = async (): Promise<number> => Number(/\/\s*(\d+)\s*nodes/.exec((await page.locator(".epoch-stats").textContent()) ?? "")?.[1]);
  const before = await total();
  for (let i = 0; i < 3; i++) {
    await item(page, 0).getByRole("button", { name: "data" }).click();
    await item(page, 0).getByRole("button", { name: "rendered" }).click();
  }
  await edit(item(page, 0), "y");
  expect(await total()).toBe(before);
  await item(page, 0).getByRole("button", { name: "remove" }).click();
  await expect(page.locator(".canvas-item")).toHaveCount(0);
});

test("the cards stay inside a narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(async () => {
    const panel = await page.locator(".panel-types .panel-body").boundingBox();
    const container = await page.locator(".rv-packed-container").boundingBox();
    expect(container!.width).toBeLessThanOrEqual(panel!.width + 1);
  }).toPass();
});

test("reset gives the standard classes and an empty canvas", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await page.getByRole("button", { name: "reset" }).click();
  await expect(page.locator(".canvas-item")).toHaveCount(0);
  await expect(chip(page, "Text_1")).toHaveCount(0);
});

test("R-38: a click into a value and out of it writes nothing", async ({ page }) => {
  await setDetail(page, "type graph", "all");
  const numCard = card(page, "Num");
  await numCard.locator(".rv-expr-lit.rv-clickable").first().click();
  await numCard.locator("input.rv-editing").first().press("Tab");
  await expect(numCard.locator("input.rv-editing")).toHaveCount(0);
  await expect(page.locator(".epoch-stats")).toHaveCount(0);
  await expect(page.locator(".rv-notice")).toHaveCount(0);
});

// === Level of detail, formulas, undo, the session file, the keyboard and the theme ===

test("a disclosure control expands a card to its definition, and collapses it again", async ({ page }) => {
  const errors = watchErrors(page);
  const textCard = card(page, "Text");
  await textCard.getByRole("button", { name: "expand ClassDef" }).click();
  await expect(textCard.locator(".rv-lod-full")).toHaveCount(1);
  await expect(textCard).toContainText("methods");
  // Below the card, the methods are a collapsed grid
  await textCard.getByRole("button", { name: "expand Grid" }).last().click();
  await expect(textCard.locator(".rv-formula").first()).toBeVisible();
  await textCard.getByRole("button", { name: "collapse ClassDef" }).click();
  await expect(textCard.locator(".rv-boundary")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a formula edit of a render method reaches the canvas, and a syntax error keeps the input", async ({ page }) => {
  const errors = watchErrors(page);
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "42");
  await setDetail(page, "type graph", "2");
  const textCard = card(page, "Text");
  await textCard.locator(".rv-formula.rv-clickable").filter({ hasText: "textView(" }).first().click();
  const input = textCard.locator("input.rv-formula");
  await input.fill("numView(get(self.cells, ");
  await input.press("Enter");
  await expect(textCard.locator(".rv-edit-error")).toBeVisible();
  await expect(input).toBeVisible();
  await input.fill('numView(get(self.cells, "value"), self.setCell)');
  await input.press("Enter");
  await expect(item(page, 0).locator(".rv-num")).toHaveText("42");
  expect(errors).toEqual([]);
});

test("undo and redo take back an edit and apply it again, from the buttons and from the keyboard", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "one");
  await edit(item(page, 0), "two");
  await page.getByRole("button", { name: "undo" }).click();
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("one");
  await page.getByRole("button", { name: "redo" }).click();
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("two");
  await page.locator(".app-title").click();
  await page.keyboard.press("Control+z");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("one");
  await page.keyboard.press("Control+Shift+z");
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("two");
});

test("undo brings back the canvas after a reset", async ({ page }) => {
  await dropOnCanvas(page, "Num");
  await page.getByRole("button", { name: "reset" }).click();
  await expect(page.locator(".canvas-item")).toHaveCount(0);
  await page.getByRole("button", { name: "undo" }).click();
  await expect(page.locator(".canvas-item")).toHaveCount(1);
});

test("the session survives a reload, and a session file restores it", async ({ page }) => {
  await dropOnCanvas(page, "Text");
  await edit(item(page, 0), "persistent");
  // The autosave waits a short time after the last change
  await page.waitForTimeout(600);
  await page.reload();
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("persistent");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "export" }).click();
  const file = await (await download).path();
  await page.getByRole("button", { name: "reset" }).click();
  await expect(page.locator(".canvas-item")).toHaveCount(0);
  await page.getByLabel("session file").setInputFiles(file);
  await expect(item(page, 0).locator(".rv-text").first()).toHaveText("persistent");
});

test("Enter on a class chip adds the class, and the add menu adds a child", async ({ page }) => {
  const errors = watchErrors(page);
  await chip(page, "VStack").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".canvas-item")).toHaveCount(1);
  await item(page, 0).getByLabel("add a child").first().selectOption("Num");
  await expect(item(page, 0).locator(".rv-num")).toHaveText("0");
  // A container with children has no drop zone: the container itself is the target
  await expect(item(page, 0).locator(".rv-drop-zone")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the theme button changes the theme, and the choice survives a reload", async ({ page }) => {
  const before = await page.locator(".app").getAttribute("data-theme");
  const next = before === "dark" ? "light" : "dark";
  await page.getByRole("button", { name: `${next} theme` }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", next);
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", next);
});
