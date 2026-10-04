/**
 * Sets or checks the one shared version of the published packages, the
 * non-private packages under `packages/`.
 *
 *   node scripts/release-version.mjs              check, print the version
 *   node scripts/release-version.mjs <version>    set, then check
 *
 * The check fails unless every published package carries the same alpha
 * version. Uses only `node:` modules so it runs before `pnpm install`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SemVer forbids leading zeros in numeric identifiers, and npm rejects them.
const NUMBER = "(?:0|[1-9]\\d*)";
const ALPHA_VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}-alpha\\.${NUMBER}$`
);

const packagesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages"
);

function readPublished() {
  return fs
    .readdirSync(packagesRoot)
    .map((dir) => path.join(packagesRoot, dir, "package.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      file,
      manifest: JSON.parse(fs.readFileSync(file, "utf8")),
    }))
    .filter(({ manifest }) => !manifest.private);
}

function refuse(message) {
  console.error(message);
  process.exit(1);
}

const [requested] = process.argv.slice(2);
if (requested !== undefined) {
  if (!ALPHA_VERSION.test(requested))
    refuse(
      `Expected an alpha version such as 0.1.0-alpha.0, received ${requested}`
    );
  for (const { file } of readPublished()) {
    // Replace only the version field so the manifest keeps its formatting.
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      source.replace(/("version":\s*)"[^"]*"/, `$1"${requested}"`)
    );
  }
}

// Read the manifests again, so a set that did not land fails the check.
const published = readPublished();
const versions = new Set(published.map(({ manifest }) => manifest.version));
const listing = published
  .map(({ manifest }) => `  ${manifest.name}@${manifest.version}`)
  .join("\n");
if (versions.size !== 1)
  refuse(`Published packages differ in version:\n${listing}`);
const [version] = versions;
if (!ALPHA_VERSION.test(version))
  refuse(`Expected an alpha version such as 0.1.0-alpha.0:\n${listing}`);
console.log(version);
