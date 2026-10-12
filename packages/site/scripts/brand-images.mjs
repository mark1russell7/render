// This script renders the images of the site to public/: the share card (og.png, 1200 by 630) from
// scripts/og-card.html, and the app icons from src/assets/mark.svg. Start it after a change of the card or the mark:
//   node scripts/brand-images.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const mark = await readFile(new URL("../src/assets/mark.svg", import.meta.url), "utf8");

const browser = await chromium.launch();

// The share card
const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await card.goto(new URL("./og-card.html", import.meta.url).href);
await card.evaluate(() => document.fonts.ready);
await card.screenshot({ path: out("og.png"), type: "png" });
console.info(`wrote ${out("og.png")}`);

// The icons: the mark on the page color. A maskable icon keeps the mark in the inner 60 percent.
const icons = [
  { name: "apple-touch-icon.png", size: 180, inner: 0.78 },
  { name: "icon-192.png", size: 192, inner: 0.82 },
  { name: "icon-512.png", size: 512, inner: 0.82 },
  { name: "icon-maskable-512.png", size: 512, inner: 0.6 },
];
for (const { name, size, inner } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const side = Math.round(size * inner);
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:#f5f6f9">` +
      `<div style="width:${side}px;height:${side}px">${mark.replace(/width="32" height="32"/u, 'width="100%" height="100%"')}</div></body>`,
  );
  await page.screenshot({ path: out(name), type: "png" });
  console.info(`wrote ${out(name)}`);
  await page.close();
}

await browser.close();
