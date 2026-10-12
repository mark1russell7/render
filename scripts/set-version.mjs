// This script sets the version of each published package, thus the packages keep one version together:
//   node scripts/set-version.mjs 0.2.0
// With --check, it changes nothing: it fails when a package has another version. The release workflow uses it to
// compare the tag with the packages.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGES = ["optional", "dsl", "node", "biblo", "splay", "pack", "seat", "viewer"];
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const version = args.find((a) => !a.startsWith("--"));
if (version === undefined || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(version)) {
  console.error("Give a version, for example: node scripts/set-version.mjs 0.2.0");
  process.exit(1);
}

let wrong = 0;
for (const name of PACKAGES) {
  const file = join(root, "packages", name, "package.json");
  const text = readFileSync(file, "utf8");
  const pkgName = /"name": "([^"]+)"/u.exec(text)?.[1] ?? name;
  const current = /"version": "([^"]+)"/u.exec(text)?.[1];
  if (check) {
    if (current !== version) {
      console.error(`${pkgName} has the version ${current ?? "(none)"}, not ${version}`);
      wrong++;
    }
    continue;
  }
  writeFileSync(file, text.replace(/"version": "[^"]+"/u, `"version": "${version}"`));
  console.info(`${pkgName}: ${version}`);
}
if (wrong > 0) process.exit(1);
