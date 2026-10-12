// This script tells the search engines of IndexNow (Bing, Yandex and others) about each page of the deployed site.
// The Pages workflow starts it after each deployment. The key file in public/ proves that the site owns the key.
//   node scripts/indexnow.mjs
const KEY = "d081d74399af0acaa87d7d6a8a8d090c";
const site = "https://mark1russell7.github.io/render/";

const index = await (await fetch(new URL("sitemap-index.xml", site))).text();
const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((m) => m[1]);
const urls = [];
for (const map of maps) {
  const xml = await (await fetch(map)).text();
  urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((m) => m[1]));
}
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: "mark1russell7.github.io", key: KEY, keyLocation: new URL(`${KEY}.txt`, site).href, urlList: urls }),
});
console.info(`IndexNow: ${String(urls.length)} pages, status ${String(response.status)}`);
if (!response.ok && response.status !== 202) process.exitCode = 1;
