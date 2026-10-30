/**
 * Publishes a release's packed tarballs, `@ayme-dev/ayme` first and the rest
 * by name.
 *
 *   node scripts/publish-packages.mjs <directory> <version>
 *
 * It fails before publishing anything when a tarball is not at `<version>`.
 * A version the registry already has is skipped, so the rerun of a release
 * that failed partway finishes it; any other registry answer fails the run.
 * Uses only `node:` modules so it runs without `pnpm install`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAIN_PACKAGE = "@ayme-dev/ayme";

const [directory, version] = process.argv.slice(2);
const registry =
  process.env.npm_config_registry ?? "https://registry.npmjs.org";

function readPacked(tarball) {
  const manifest = execFileSync(
    "tar",
    ["-xzOf", tarball, "package/package.json"],
    { encoding: "utf8" }
  );
  return { ...JSON.parse(manifest), tarball };
}

// The other packages depend on the main package, so it goes first.
function inPublishOrder(packages) {
  return packages.toSorted(
    (a, b) =>
      (b.name === MAIN_PACKAGE) - (a.name === MAIN_PACKAGE) ||
      a.name.localeCompare(b.name)
  );
}

async function isPublished({ name, version }) {
  const response = await fetch(
    `${registry}/${name.replace("/", "%2f")}/${version}`
  );
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new Error(
    `${registry} answered ${response.status} for ${name}@${version}`
  );
}

const packages = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith(".tgz"))
  .map((file) => readPacked(path.join(directory, file)));

const strays = packages.filter((packed) => packed.version !== version);
if (strays.length > 0) {
  const listing = strays
    .map(({ name, version }) => `  ${name}@${version}`)
    .join("\n");
  console.error(`Expected every tarball at ${version}:\n${listing}`);
  process.exit(1);
}

for (const packed of inPublishOrder(packages)) {
  const id = `${packed.name}@${packed.version}`;
  if (await isPublished(packed)) {
    console.log(`Skipping ${id}: the registry already has it`);
    continue;
  }
  console.log(`Publishing ${id}`);
  execFileSync(
    "npm",
    ["publish", packed.tarball, "--access", "public", "--ignore-scripts"],
    { stdio: "inherit" }
  );
}
