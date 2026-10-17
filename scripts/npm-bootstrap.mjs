// The one-time bootstrap of npm trusted publishing: the first version of each public package, and
// the connection of each package to .github/workflows/release.yml.
//
// npm trusts a workflow only for a package that exists (HTTP 404 for the others). Thus:
//   1. CI builds and checks the tarballs: the workflow pack.yml
//      (gh workflow run pack.yml --repo mark1russell7/render)
//   2. In your own terminal, because npm needs the 2FA of the owner:
//      node scripts/npm-bootstrap.mjs
//      It downloads the tarballs of the newest successful pack run, publishes each version that is
//      not on npm, and then connects each package to release.yml. For each command, npm opens the
//      browser: confirm with your security key. When npm fails, the script tells why (a rate limit
//      or a refused 2FA) and what to do.
// After this, a tag v<version> publishes each later version from release.yml, with no token.
//
// Options: --dry-run, --otp <code> (the code of an authenticator app, for an account that has one),
//          --from <folder> (the tarballs in a folder, in place of the download).
// The token fallback, when npm refuses the browser 2FA (EOTP after the approval):
//   1. On npmjs.com: Access Tokens > Generate New Token > Granular Access Token. Permissions: Read
//      and write, all packages. Check "Bypass two-factor authentication". Expiration: 1 day.
//   2. In the same terminal (Git Bash): NPM_BOOTSTRAP_TOKEN=<the token> node scripts/npm-bootstrap.mjs
//      The script writes the token to a temporary npmrc for its npm commands, and removes the file
//      at exit. The token never goes on a command line.
//   3. Delete the token on npmjs.com after the run.
// Start it again after a failure: it skips each version on npm and each package that trusts the workflow.
// The same procedure as client/scripts/npm-bootstrap.mjs.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = "mark1russell7/render";
const WORKFLOW = "release.yml";
const ENVIRONMENT = "npm";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const value = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const otp = value("--otp");
const from = value("--from");
if (argv.includes("--otp") && !/^\d{6,8}$/.test(otp ?? "")) {
  console.error("--otp needs the digits of an authenticator code. Without an authenticator app, leave --otp out: npm opens the browser.");
  process.exit(1);
}

const root = join(import.meta.dirname, "..");
const shell = process.platform === "win32";

/** This function starts a command quietly, and gives its output (the empty string on a failure). */
function quiet(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });   // gh: an .exe, no shell
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : "";
}

// npm runs as `node npm-cli.js` when that file is found: no shell, so each argument stays exact
// (a shell joins the arguments: an empty one disappears, and Node warns with DEP0190).
const npmCli = [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), process.env.npm_execpath]
  .find((f) => typeof f === "string" && f.endsWith("npm-cli.js") && existsSync(f));

// The token fallback (refer to the top of this file): a temporary npmrc, removed at exit.
let userconfig;
if (process.env.NPM_BOOTSTRAP_TOKEN) {
  const dir = mkdtempSync(join(tmpdir(), "npm-bootstrap-"));
  userconfig = join(dir, ".npmrc");
  writeFileSync(userconfig, `//registry.npmjs.org/:_authToken=${process.env.NPM_BOOTSTRAP_TOKEN}\n`, { mode: 0o600 });
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}

function npmCommand(args) {
  const all = userconfig ? [...args, "--userconfig", userconfig] : args;
  return npmCli ? { cmd: process.execPath, args: [npmCli, ...all], shell: false } : { cmd: "npm", args: all, shell };
}

function quietNpm(args) {
  const c = npmCommand(args);
  const r = spawnSync(c.cmd, c.args, { cwd: root, encoding: "utf8", shell: c.shell });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : "";
}

/** This function starts an npm command in the terminal of the user. npm's errors show as they
 *  come, and the script also reads them, to tell why a command failed. */
function interactive(args) {
  const c = npmCommand(args);
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, { cwd: root, stdio: ["inherit", "inherit", "pipe"], shell: c.shell });
    let errors = "";
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); errors += chunk; });
    child.on("close", (status) => resolve({ status: status ?? 1, errors }));
  });
}

function why(errors) {
  if (/E429|Too Many Requests|rate limit/i.test(errors)) {
    return "npm limits how many new packages one account can publish in a time (E429). Wait until the limit resets (it can take a day), and start the script again. It skips each version on npm.";
  }
  if (/EOTP|one-time password/i.test(errors)) {
    return "npm did not accept the 2FA. Start the script again and confirm in the browser at once. If it fails again, use the token fallback at the top of scripts/npm-bootstrap.mjs.";
  }
  return "";
}

/** This function starts an npm command that needs the 2FA: npm opens the browser to confirm, or it
 *  uses --otp, or the token. It gives the exit status, and prints the reason of a failure. */
async function with2fa(args) {
  const r = await interactive(otp && !dryRun ? [...args, "--otp", otp] : args);
  if (r.status !== 0 && why(r.errors)) console.error(`\n${why(r.errors)}`);
  return r.status;
}

const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "packages", d.name, "package.json")))
  .map((d) => JSON.parse(readFileSync(join(root, "packages", d.name, "package.json"), "utf8")))
  .filter((p) => !p.private)
  .map((p) => ({ name: p.name, version: p.version, tarball: `${p.name.replace(/^@/, "").replace("/", "-")}-${p.version}.tgz` }))
  .sort((a, b) => a.name.localeCompare(b.name));

const onNpm = (name, version) => quietNpm(["view", `${name}@${version}`, "version"]) === version;
const exists = (name) => {
  const latest = quietNpm(["view", name, "dist-tags.latest"]);
  return latest !== "" && latest !== "0.0.0-stage";
};
const trusts = (name) => {
  const text = quietNpm(["trust", "list", name, "--json"]);
  return text.includes(`"repository": "${REPO}"`) && text.includes(`"file": "${WORKFLOW}"`);
};

const who = quietNpm(["whoami"]);
if (!who) {
  console.error(userconfig ? "npm does not accept NPM_BOOTSTRAP_TOKEN. Check the token." : "npm has no valid login. Start `npm login` first.");
  process.exit(1);
}
console.log(`npm user: ${who}${userconfig ? " (the token of NPM_BOOTSTRAP_TOKEN)" : ""}\n`);

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
    if (spawnSync("gh", ["run", "download", run, "--repo", REPO, "--name", "render-tarballs", "--dir", dir], { stdio: "inherit" }).status !== 0) {
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
