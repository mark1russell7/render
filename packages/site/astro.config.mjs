// The site of render: the guide, the live viewer and the review. GitHub Pages serves it at /render/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const base = process.env.SITE_BASE ?? "/render";
const site = "https://mark1russell7.github.io";

// The share card of each page (Open Graph and Twitter). scripts/brand-images.mjs renders it.
const card = `${site}${base}/og.png`;
const cardAlt =
  "render: an interface that renders its own expressions. A graph of nodes on graph paper, with the order of one epoch.";

export default defineConfig({
  site,
  base,
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "render",
      description: "A reactive expression engine whose interface renders its own expressions.",
      logo: { src: "./src/assets/mark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      head: [
        { tag: "meta", attrs: { property: "og:image", content: card } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: cardAlt } },
        { tag: "meta", attrs: { name: "twitter:image", content: card } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: cardAlt } },
        { tag: "meta", attrs: { name: "theme-color", content: "#f5f6f9", media: "(prefers-color-scheme: light)" } },
        { tag: "meta", attrs: { name: "theme-color", content: "#0e1220", media: "(prefers-color-scheme: dark)" } },
        { tag: "meta", attrs: { name: "author", content: "Mark Russell" } },
        {
          tag: "meta",
          attrs: {
            name: "keywords",
            content:
              "reactive programming, TypeScript, expression engine, dataflow, dependency graph, incremental computation, live programming, visual editor, formula language, signals, spreadsheet engine",
          },
        },
        // The owner proves the ownership of the site to Google Search Console with this tag.
        { tag: "meta", attrs: { name: "google-site-verification", content: "du_C4Y04G9XX4VZEjxZEcBq3e28zER6jS1H_NYgIaEY" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: `${base}/apple-touch-icon.png` } },
        { tag: "link", attrs: { rel: "manifest", href: `${base}/site.webmanifest` } },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/mark1russell7/render" }],
      editLink: { baseUrl: "https://github.com/mark1russell7/render/edit/main/packages/site/" },
      customCss: [
        "@fontsource-variable/atkinson-hyperlegible-next",
        "@fontsource-variable/atkinson-hyperlegible-mono",
        "./src/styles/tokens.css",
        "./src/styles/theme.css",
        "./src/styles/home.css",
      ],
      components: { Hero: "./src/components/Hero.astro" },
      sidebar: [
        { label: "Learn", items: ["learn/tour", "learn/nodes", "learn/expressions", "learn/classes", "learn/splay", "learn/lod"] },
        { label: "Viewer", items: ["viewer"] },
        { label: "Reference", items: ["reference/api", "reference/extension"] },
        { label: "Design", items: ["design/architecture", "design/review", "design/decisions"] },
        { label: "About", items: ["about"] },
        // The pages of @mark1russell7/site-pages: the Pages workflow writes them at deploy time
        {
          label: "Project",
          items: [
            { label: "Releases", link: "https://mark1russell7.github.io/render/releases/" },
            { label: "Status", link: "https://mark1russell7.github.io/render/status/" },
          ],
        },
      ],
    }),
    react(),
  ],
});
