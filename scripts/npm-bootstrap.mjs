// The one-time bootstrap of npm trusted publishing: the first version of each public package, and
// the connection of each package to .github/workflows/release.yml.
//
// npm trusts a workflow only for a package that exists (HTTP 404 for the others). Thus:
//   1. CI builds and checks the tarballs: the workflow pack.yml
//      (gh workflow run pack.yml --repo mark1russell7/render)
//   2. In your own terminal, because npm needs the 2FA of the owner:
//      node scripts/npm-bootstrap.mjs
//      It downloads the tarballs of the newest successful pack run, publishes each version that is
//      not on npm, and then connects each package to release.yml. Before each npm command that
//      needs the 2FA, it asks for the code of your authenticator app (a code is used again for
//      20 seconds). When npm refuses a code, it asks for a new one.
// After this, a tag v<version> publishes each later version from release.yml, with no token.
//
// Options: --dry-run, --otp <code> (the first code), --browser (no codes: npm opens the browser to
//          confirm -- on 2026-10-17 the registry refused the retry after the approval with EOTP),
//          --from <folder> (the tarballs in a folder, in place of the download).
// Start it again after a failure: it skips each version on npm and each package that trusts the workflow.
// The same procedure as client/scripts/npm-bootstrap.mjs.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "mark1russell7/render";
const WORKFLOW = "release.yml";
const ENVIRONMENT = "npm";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const value = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const browser = argv.includes("--browser");
const from = value("--from");

const root = join(import.meta.dirname, "..");
const shell = process.platform === "win32";

/** This function starts a command quietly, and gives its output (the empty string on a failure). */
function quiet(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : "";
}

/** This function starts an npm command in the terminal of the user (its output shows there). */
function interactive(args) {
  return spawnSync("npm", args, { cwd: root, stdio: "inherit", shell }).status ?? 1;
}

// The code of the authenticator app: asked for when there is no code from the last 20 seconds.
let code = value("--otp");
let codeAt = code ? Date.now() : 0;
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
async function freshCode() {
  if (code && Date.now() - codeAt < 20_000) return code;
  code = await ask("The 6-digit code of your npm authenticator app: ");
  codeAt = Date.now();
  return code;
}

/** This function starts an npm command that needs the 2FA. With a code (the default), npm does not
 *  open the browser. When npm fails, it asks for a new code and tries again (at most 3 times). */
async function with2fa(args) {
  if (browser || dryRun) return interactive(args);
  for (let attempt = 1; ; attempt++) {
    const status = interactive([...args, "--otp", await freshCode()]);
    if (status === 0 || attempt === 3) return status;
    const next = await ask("npm refused the command. A new code to try again (Enter to stop): ");
    if (!next) return status;
    code = next;
    codeAt = Date.now();
  }
}

const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "packages", d.name, "package.json")))
  .map((d) => JSON.parse(readFileSync(join(root, "packages", d.name, "package.json"), "utf8")))
  .filter((p) => !p.private)
  .map((p) => ({ name: p.name, version: p.version, tarball: `${p.name.replace(/^@/, "").replace("/", "-")}-${p.version}.tgz` }))
  .sort((a, b) => a.name.localeCompare(b.name));

const onNpm = (name, version) => quiet("npm", ["view", `${name}@${version}`, "version"]) === version;
const exists = (name) => {
  const latest = quiet("npm", ["view", name, "dist-tags.latest"]);
  return latest !== "" && latest !== "0.0.0-stage";
};
const trusts = (name) => {
  const text = quiet("npm", ["trust", "list", name, "--json"]);
  return text.includes(`"repository": "${REPO}"`) && text.includes(`"file": "${WORKFLOW}"`);
};

const who = quiet("npm", ["whoami"]);
if (!who) {
  console.error("npm has no valid login. Start `npm login` first.");
  process.exit(1);
}
console.log(`npm user: ${who}\n`);

// 1. The first version of each package
const todo = packages.filter((p) => !onNpm(p.name, p.version));
if (todo.length > 0) {
  let dir = from;
  if (!dir) {
    const run = quiet("gh", ["run", "list", "--repo", REPO, "--workflow", "pack.yml", "--status", "success", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"]);
    if (!run) {
      console.error("No successful run of pack.yml. Start it: gh workflow run pack.yml --repo mark1russell7/render");
      process.exit(1);
    }
    dir = mkdtempSync(join(tmpdir(), "render-tarballs-"));
    console.log(`The tarballs of the pack run ${run} go to ${dir}`);
    if (spawnSync("gh", ["run", "download", run, "--repo", REPO, "--name", "render-tarballs", "--dir", dir], { stdio: "inherit", shell }).status !== 0) {
      console.error("The download failed.");
      process.exit(1);
    }
  }
  for (const p of todo) {
    const tgz = join(dir, p.tarball);
    if (!existsSync(tgz)) {
      console.error(`No tarball ${p.tarball} in ${dir}. Start pack.yml again after the version change.`);
      process.exit(1);
    }
    const args = ["publish", tgz, "--access", "public", "--provenance=false", ...(dryRun ? ["--dry-run"] : [])];
    console.log(`\nnpm publish ${p.name}@${p.version}`);
    if (await with2fa(args) !== 0) {
      console.error(`\nThe publish of ${p.name}@${p.version} failed. Start the script again: it skips each version on npm.`);
      process.exit(1);
    }
  }
}
for (const p of packages.filter((q) => !todo.includes(q))) console.log(`ok    ${p.name}@${p.version} is on npm`);

// 2. The trusted publisher of each package
const failures = [];
for (const p of packages) {
  if (!dryRun && !exists(p.name)) {
    failures.push(p.name);
    console.error(`wait  ${p.name} is not on npm yet`);
    continue;
  }
  if (trusts(p.name)) {
    console.log(`ok    ${p.name} trusts ${REPO} ${WORKFLOW}`);
    continue;
  }
  const args = ["trust", "github", p.name, "--file", WORKFLOW, "--repo", REPO, "--env", ENVIRONMENT, "--allow-publish", "--yes"];
  console.log(`\nnpm ${args.join(" ")}`);
  if (dryRun) continue;
  // npm refuses a second trust with HTTP 409: then the package trusts the workflow, which is correct
  if (await with2fa(args) !== 0 && !trusts(p.name)) failures.push(p.name);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} packages are not complete: ${failures.join(", ")}. Start the script again.`);
  process.exit(1);
}
console.log(dryRun
  ? "\nThe dry run printed each command."
  : `\nEach of the ${packages.length} packages is on npm and trusts ${WORKFLOW}. A tag v<version> publishes the next version.`);
