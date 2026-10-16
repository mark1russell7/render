// Connect each public package to .github/workflows/release.yml: npm trusted publishing (OIDC).
// After this, a tag v<version> publishes the packages from the workflow, with no token.
//
// Start it in your own terminal, because npm needs the 2FA of the owner:
//   node scripts/npm-trust.mjs              npm opens the browser to confirm each package
//   node scripts/npm-trust.mjs --otp 123456 the code of the authenticator app (valid for a short time)
//   node scripts/npm-trust.mjs --dry-run    what the script would do
//
// The script skips a package that trusts the workflow already. Start it again after a failure.
// The same procedure as `client/scripts/npm-bootstrap.mjs --trust`.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "mark1russell7/render";
const WORKFLOW = "release.yml";
const ENVIRONMENT = "npm";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const otpIndex = argv.indexOf("--otp");
const otp = otpIndex === -1 ? undefined : argv[otpIndex + 1];

const root = join(import.meta.dirname, "..");
const shell = process.platform === "win32";
const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    try {
      return JSON.parse(readFileSync(join(root, "packages", d.name, "package.json"), "utf8"));
    } catch {
      return undefined;
    }
  })
  .filter((p) => p && !p.private)
  .map((p) => p.name)
  .sort();

/** This function tells if a package trusts the workflow already. `npm trust list` needs no 2FA. */
function trusts(name) {
  const r = spawnSync("npm", ["trust", "list", name, "--json"], { cwd: root, encoding: "utf8", shell });
  const text = `${r.stdout ?? ""}`;
  return text.includes(`"repository": "${REPO}"`) && text.includes(`"file": "${WORKFLOW}"`);
}

const who = spawnSync("npm", ["whoami"], { cwd: root, encoding: "utf8", shell });
if (who.status !== 0) {
  console.error("npm has no valid login. Start `npm login` first.");
  process.exit(1);
}
console.log(`npm user: ${who.stdout.trim()}\n`);

const failures = [];
for (const name of packages) {
  if (trusts(name)) {
    console.log(`ok    ${name} trusts ${REPO} ${WORKFLOW} already`);
    continue;
  }
  const args = ["trust", "github", name, "--file", WORKFLOW, "--repo", REPO, "--env", ENVIRONMENT, "--allow-publish", "--yes",
    ...(otp ? ["--otp", otp] : [])];
  console.log(`npm ${args.join(" ")}`);
  if (dryRun) continue;
  // The terminal of the user: npm opens the browser for the 2FA, and waits.
  const status = spawnSync("npm", args, { cwd: root, stdio: "inherit", shell }).status ?? 1;
  if (status !== 0) failures.push(name);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} packages failed: ${failures.join(", ")}. Start the script again.`);
  process.exit(1);
}
console.log(dryRun ? "\nThe dry run printed each command." : `\nEach of the ${packages.length} packages trusts the workflow. Push the tag v<version> to publish.`);
