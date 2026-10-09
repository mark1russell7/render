// The site of render: the guide, the live viewer and the review. GitHub Pages serves it at /render/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const base = process.env.SITE_BASE ?? "/render";

export default defineConfig({
  site: "https://mark1russell7.github.io",
  base,
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "render",
      description: "A reactive expression engine whose interface renders its own expressions.",
      logo: { src: "./src/assets/mark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/mark1russell7/render" }],
      editLink: { baseUrl: "https://github.com/mark1russell7/render/edit/main/packages/site/" },
      customCss: [
        "@fontsource-variable/atkinson-hyperlegible-next",
        "@fontsource-variable/atkinson-hyperlegible-mono",
        "./src/styles/tokens.css",
        "./src/styles/theme.css",
      ],
      sidebar: [
        { label: "Learn", items: ["learn/tour", "learn/nodes", "learn/expressions", "learn/classes", "learn/splay", "learn/lod"] },
        { label: "Viewer", items: ["viewer"] },
        { label: "Reference", items: ["reference/api", "reference/extension"] },
        { label: "Design", items: ["design/architecture", "design/review", "design/decisions"] },
        { label: "About", items: ["about"] },
      ],
    }),
    react(),
  ],
});
