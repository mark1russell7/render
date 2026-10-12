import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App, KEPT_SUFFIX } from "./App.tsx";
import { ViewerSession } from "./session.ts";
import { viewerOps } from "./renderers.tsx";

/** A local storage in memory. The App reads it through `window.localStorage`. */
const memoryStorage = (): Storage & { readonly map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    clear: () => { map.clear(); },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
};

/** This helper renders the App with an autosave in a memory storage, and gives the HTML and the storage. */
const renderWithAutosave = (raw: string | null, kept: string | null = null): { html: string; storage: ReturnType<typeof memoryStorage> } => {
  const storage = memoryStorage();
  if (raw !== null) storage.setItem("k", raw);
  if (kept !== null) storage.setItem(`k${KEPT_SUFFIX}`, kept);
  vi.stubGlobal("window", { localStorage: storage });
  const html = renderToStaticMarkup(createElement(App, { storageKey: "k" }));
  return { html, storage };
};

/** A saved session of two actions whose second place names another class, as from another version of the viewer. */
const brokenSave = (): string => {
  const s = new ViewerSession(viewerOps);
  s.editCell(s.dropClass("Text")!, "value", "kept");
  const saved = JSON.parse(JSON.stringify(s.save())) as { actions: { at?: { classRef: string } }[] };
  saved.actions[1]!.at!.classRef = "Num";
  return JSON.stringify(saved);
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("the autosave of the App", () => {
  it("R-49: an autosave that does not load in full stays under another key, and the page offers it", () => {
    const raw = brokenSave();
    const { html, storage } = renderWithAutosave(raw);
    expect(storage.getItem(`k${KEPT_SUFFIX}`)).toBe(raw);
    expect(html).toContain('aria-label="kept session"');
    expect(html).toContain("action 2 of 2");
  });

  it("R-49: a damaged autosave stays too, and a kept session from before stays", () => {
    expect(renderWithAutosave("{ not json").storage.getItem(`k${KEPT_SUFFIX}`)).toBe("{ not json");
    expect(renderWithAutosave(brokenSave(), "older").storage.getItem(`k${KEPT_SUFFIX}`)).toBe("older");
  });

  it("an autosave that loads in full keeps no copy", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    const { html, storage } = renderWithAutosave(JSON.stringify(s.save()));
    expect(storage.map.has(`k${KEPT_SUFFIX}`)).toBe(false);
    expect(html).not.toContain("kept session");
    expect(html).toContain("canvas-item");
  });
});

describe("a touch screen", () => {
  it("R-51: the canvas has an add menu of the classes, and each child of a container can take the focus", () => {
    const s = new ViewerSession(viewerOps);
    const stack = s.dropClass("VStack")!;
    s.addChild(stack, "Num");
    const html = renderToStaticMarkup(createElement(App, { session: s, storageKey: null }));
    expect(html).toContain('aria-label="add a class to the canvas"');
    expect(html).toContain('<option value="Text">Text</option>');
    expect(html).toContain('<div class="rv-child" tabindex="-1">');
  });

  it("R-51: the toolbar wraps, a column is never wider than its share, and a coarse pointer gets larger controls", () => {
    const css = readFileSync(new URL("styles.css", import.meta.url), "utf8");
    // The bodies of each top-level rule of a selector, joined
    const rule = (selector: string): string =>
      [...css.matchAll(new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`, "gu"))].map((m) => m[1]).join("\n");
    expect(rule(".app-toolbar")).toContain("flex-wrap: wrap");
    expect(rule(".app")).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*\.rv-child-tool \{[\s\S]*width: 28px/u);
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.rv-add \{\s*opacity: 1/u);
  });
});
