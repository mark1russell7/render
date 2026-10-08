// This script makes the review page and the decisions page of the site from docs/REVIEW.md and docs/DECISIONS.md.
// Thus the documents in the repository are the one source. In the review, the first cell of each defect row
// becomes a chip that shows the status of the regression test of the defect.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(site, "..", "..", "docs");
const out = join(site, "src", "content", "docs", "design");
const blob = "https://github.com/mark1russell7/render/blob/main/docs/";

/** MDX reads `{`, `}` and `<` as code. Outside code spans and fences, this function escapes them. */
const escapeMdx = (text) => {
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/[{}]/g, (c) => `\\${c}`).replace(/</g, "&lt;")))
        .join("");
    })
    .join("\n");
};

/** A relative link to another document becomes a link to the file on GitHub. */
const linkDocs = (text) =>
  text.replace(/\]\((?!https?:|#)(?:\.\/)?([^)]+)\)/g, (_, target) => `](${blob}${target})`);

/** This function reads a document: its title (the first heading), its first paragraph and its body. */
const read = (file) => {
  const text = readFileSync(join(docs, file), "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const titleLine = lines.findIndex((l) => l.startsWith("# "));
  const title = lines[titleLine].slice(2).trim();
  const body = lines.slice(titleLine + 1).join("\n").trim();
  const description = body.split("\n\n")[0].replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
  return { title, description, body };
};

const frontmatter = (title, description) =>
  `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`;

const note = (file) =>
  `{/* The script scripts/gen-docs.mjs made this page from docs/${file}. Change that document, not this page. */}\n\n`;

mkdirSync(out, { recursive: true });

{
  const { title, description, body } = read("REVIEW.md");
  const mdx = linkDocs(escapeMdx(body)).replace(/^\| (R-\d\d) \|/gm, (_, id) => `| <Regression id="${id}" /> |`);
  writeFileSync(
    join(out, "review.mdx"),
    frontmatter(title, description) + 'import Regression from "../../../components/Regression.tsx";\n\n' + note("REVIEW.md") + mdx + "\n",
  );
}

{
  const { title, description, body } = read("DECISIONS.md");
  writeFileSync(join(out, "decisions.mdx"), frontmatter(title, description) + note("DECISIONS.md") + linkDocs(escapeMdx(body)) + "\n");
}

console.info("gen-docs: design/review.mdx and design/decisions.mdx");
