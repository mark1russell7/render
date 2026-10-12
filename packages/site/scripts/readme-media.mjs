// This script records the live hero of the home page to docs/media/hero-light.gif and hero-dark.gif, for the README.
// It needs the built site on the preview server and ffmpeg on the PATH:
//   pnpm run build && pnpm exec astro preview --port 4331 --host 127.0.0.1
//   node scripts/readme-media.mjs
// A fake clock drives the timers of the page, thus each frame is 100 ms of page time and the result is the same.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const url = process.env.SITE_URL ?? "http://127.0.0.1:4331/render/";
const media = fileURLToPath(new URL("../../../docs/media/", import.meta.url));
mkdirSync(media, { recursive: true });
const FRAMES = 78;
const FRAME_MS = 100;

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const work = mkdtempSync(join(tmpdir(), "render-media-"));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1, colorScheme: scheme });
    await page.clock.install();
    await page.goto(url);
    const hero = page.locator(".rh-hero");
    await hero.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    // The island is ready when React keeps its props on the element
    await page.waitForFunction(() => {
      const live = document.querySelector(".rh-live");
      return live !== null && Object.keys(live).some((k) => k.startsWith("__reactProps$"));
    });
    // The fake clock also stops performance.now, thus the time of an epoch is not real: the recording hides it
    await page.addStyleTag({ content: ".rh-stats > div:last-child { visibility: hidden; }" });
    const box = await hero.boundingBox();
    if (box === null) throw new Error("the hero is not visible");
    const clip = { x: Math.floor(box.x) - 8, y: Math.floor(box.y) - 8, width: Math.ceil(box.width) + 16, height: Math.ceil(box.height) + 16 };
    for (let i = 0; i < FRAMES; i++) {
      await page.clock.runFor(FRAME_MS);
      await page.screenshot({ path: join(work, `frame-${String(i).padStart(3, "0")}.png`), clip });
    }
    await page.close();
    const out = join(media, `hero-${scheme}.gif`);
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-framerate", String(1000 / FRAME_MS), "-i", join(work, "frame-%03d.png"),
      "-vf", "scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
      "-loop", "0", out,
    ]);
    console.info(`wrote ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
await browser.close();
