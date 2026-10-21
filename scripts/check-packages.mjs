// The package check. This script builds and packs each published package, checks each tarball with publint and
// attw, installs the tarballs in an empty project, runs a program against them, and type-checks a TypeScript file
// against their declarations. CI starts it, and the release starts it before it publishes.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PACKAGES = ["optional", "dsl", "node", "biblo", "splay", "pack", "seat", "viewer"];
const work = mkdtempSync(join(tmpdir(), "render-pack-"));
// One command line with quoted arguments: pnpm and npm are scripts on Windows, thus they need a shell.
/** @type {(cmd: string, args: readonly string[], cwd: string) => void} */
const run = (cmd, args, cwd) => execSync([cmd, ...args.map((a) => JSON.stringify(a))].join(" "), { cwd, stdio: "inherit" });

try {
  run("pnpm", ["build"], root);
  const tarballs = PACKAGES.map((p) => {
    const out = join(work, p);
    mkdirSync(out);
    run("pnpm", ["pack", "--pack-destination", out], join(root, "packages", p));
    const file = readdirSync(out).find((f) => f.endsWith(".tgz"));
    if (file === undefined) throw new Error(`no tarball for ${p}`);
    const tgz = join(out, file);
    run("pnpm", ["exec", "publint", "run", tgz, "--strict"], root);
    const css = p === "viewer" ? ["--exclude-entrypoints", "./styles.css"] : [];
    run("pnpm", ["exec", "attw", tgz, "--profile", "esm-only", ...css], root);
    return tgz;
  });

  // An empty project that installs the tarballs, as a person installs the packages from npm
  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "render-smoke", private: true, type: "module" }));
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "react@19", "@types/react@19", ...tarballs], app);

  // The program of the README, and one import of each package
  writeFileSync(
    join(app, "smoke.mjs"),
    `import { app, lit, ref, parseExpr, formatExpr, toDocument, fromDocument } from "@mark1russell7/render-dsl";
import { addNode, nodeStore, readValue, setValue } from "@mark1russell7/render-node";
import { standardOps, standardClasses, splayKit, hydrate, dehydrate, defaultClassFor } from "@mark1russell7/render-splay";
import { biblo, registerClasses, classNodeOps } from "@mark1russell7/render-biblo";
import { some } from "@mark1russell7/render-optional";
import { pack, Rect } from "@mark1russell7/render-pack";
import { registry, subscribe, setRoot } from "@mark1russell7/render-seat";
import { ViewerSession } from "@mark1russell7/render-viewer";

const store = nodeStore({ ops: standardOps });
addNode(store, lit(2), "w");
addNode(store, lit(4), "h");
addNode(store, app("*", ref("w"), ref("h")), "area");
setValue(store, "w", 3);
const area = readValue(store, "area");
if (JSON.stringify(area) !== JSON.stringify(some(12))) throw new Error("area gave " + JSON.stringify(area));
const parsed = parseExpr("max(2, 3) * 4");
if (!parsed.ok || formatExpr(parsed.expr) !== "max(2, 3) * 4") throw new Error("the formula round trip failed");
// A document from JSON text, as from storage: the dsl reads it with the helpers of coeval from npm
const stored = JSON.parse(JSON.stringify(toDocument(app("*", ref("w"), ref("h")))));
addNode(store, stored, "area2");
if (JSON.stringify(readValue(store, "area2")) !== JSON.stringify(some(12))) throw new Error("the document gave " + JSON.stringify(readValue(store, "area2")));
if (formatExpr(fromDocument(stored).value) !== "w * h") throw new Error("the document round trip failed");

const b = biblo();
const classes = nodeStore({ nodeOps: classNodeOps(b), ops: standardOps });
registerClasses(b, standardClasses);
const value = { name: "render", tags: ["a", "b"] };
const inst = hydrate(splayKit(defaultClassFor, standardOps), b, classes, value);
if (JSON.stringify(dehydrate(b, classes, inst.id)) !== JSON.stringify(value)) throw new Error("the round trip of hydrate failed");

const r = new Rect();
r.size.set(3, 2);
if (pack([r]).size.x !== 3) throw new Error("pack failed");
const reg = registry({ a: 1 });
let seen = 0;
subscribe(reg, ["a"], () => { seen++; });
setRoot(reg, { a: 2 });
if (seen !== 1) throw new Error("seat failed");
const session = new ViewerSession();
if (session.dropClass("Text") === undefined) throw new Error("the viewer session failed");
console.info("package check: the tarballs install, import and run");
`,
  );
  run("node", ["smoke.mjs"], app);

  // A consumer in TypeScript with the strict options and the resolution of Node
  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "es2023", module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, skipLibCheck: false, types: [], jsx: "react-jsx" },
      files: ["consumer.ts"],
    }),
  );
  writeFileSync(
    join(app, "consumer.ts"),
    `import type { Optional } from "@mark1russell7/render-optional";
import { app, lit, ref, toDocument, type ExprDocument, type Ops } from "@mark1russell7/render-dsl";
import { addNode, nodeStore, readValue, type NodeStore } from "@mark1russell7/render-node";
import { standardOps } from "@mark1russell7/render-splay";
import type { Biblo } from "@mark1russell7/render-biblo";
import type { SeatRegistry } from "@mark1russell7/render-seat";
import { Rect } from "@mark1russell7/render-pack";
import { App, ViewerSession, type SavedSession } from "@mark1russell7/render-viewer";

const ops: Ops = { ...standardOps, double: (x: number) => x * 2 };
const store: NodeStore = nodeStore({ ops });
addNode(store, app("double", lit(21)), "x");
const doc: ExprDocument = toDocument(app("double", ref("x")));
addNode(store, doc, "y");
const x: Optional<unknown> = readValue(store, "x");
const saved: SavedSession = new ViewerSession().save();
export const all: readonly unknown[] = [x, saved, ref("x"), new Rect(), App, null as Biblo | null, null as SeatRegistry | null];
`,
  );
  run("pnpm", ["exec", "tsc", "-p", join(app, "tsconfig.json")], root);
  console.info("package check: the declarations type-check in a strict consumer");
} finally {
  rmSync(work, { recursive: true, force: true });
}
