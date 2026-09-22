import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumer = mkdtempSync(join(tmpdir(), "ayme-core-consumer-"));
const useBuilt = process.argv[2] === "--built";
const artifacts = resolve(
  process.argv[useBuilt ? 3 : 2] ?? join(consumer, "artifacts")
);
mkdirSync(artifacts, { recursive: true });
const run = (command, args, cwd = consumer) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
// Turbo's test:e2e already depends on build; rebuilding would clean dist while consumers read it.
if (!useBuilt) run("pnpm", ["run", "build"], packageDir);
run("pnpm", ["pack", "--pack-destination", artifacts], packageDir);
const version = JSON.parse(
  readFileSync(join(packageDir, "package.json"))
).version;
const tarball = join(artifacts, `ayme-dev-core-${version}.tgz`);
const contents = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
  .trim()
  .split("\n");
assert.ok(
  contents.every((path) =>
    /^package\/(dist\/[^/]+\.(mjs|d\.mts)|package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.txt)$/.test(
      path
    )
  )
);
assert.ok(contents.includes("package/README.md"));
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" })
);
// First prove runtime installation without any browser or tooling dependency.
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
for (const name of ["installed.test.mjs", "installed-types.ts"])
  copyFileSync(join(packageDir, "scripts", name), join(consumer, name));
run("node", ["--test", "installed.test.mjs"]);
const manifest = JSON.parse(
  readFileSync(join(consumer, "node_modules/@ayme-dev/core/package.json"))
);
assert.deepEqual(Object.keys(manifest.dependencies), ["zod"]);
assert.deepEqual(Object.keys(manifest.exports), [
  "./structural-observation",
  "./structural-observation/testing",
]);
// Read the actual public type definition at the same fork revision as this repo's adapter.
const publicRevision = "b25d782e3fbdf21abdae60e974e49b78ca07e828";
const response = await fetch(
  `https://raw.githubusercontent.com/ayme-labs/playwright/${publicRevision}/packages/isomorphic/ariaSnapshot.ts`
);
assert.ok(response.ok);
const upstream = await response.text();
assert.ok(upstream.includes("export function hasPointerCursor"));
writeFileSync(
  join(consumer, "public-aria-types.ts"),
  upstream.slice(0, upstream.indexOf("export function hasPointerCursor"))
);
run("npm", [
  "install",
  "--no-audit",
  "--no-fund",
  "--save-dev",
  "typescript@6.0.3",
  "esbuild@0.28.2",
]);
for (const resolution of ["NodeNext", "Bundler"]) {
  run("node", [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "false",
    "--target",
    "ES2024",
    "--module",
    resolution === "NodeNext" ? "NodeNext" : "ESNext",
    "--moduleResolution",
    resolution,
    "installed-types.ts",
  ]);
}
writeFileSync(
  join(consumer, "browser.mjs"),
  'export * from "@ayme-dev/core/structural-observation";\nexport * from "@ayme-dev/core/structural-observation/testing";\n'
);
run(join(consumer, "node_modules/.bin/esbuild"), [
  "browser.mjs",
  "--bundle",
  "--platform=browser",
  "--format=esm",
  "--outfile=browser-bundle.mjs",
  "--metafile=browser-graph.json",
]);
const graph = JSON.parse(readFileSync(join(consumer, "browser-graph.json")));
assert.ok(
  Object.keys(graph.inputs).every(
    (path) =>
      path === "browser.mjs" ||
      path.startsWith("node_modules/@ayme-dev/core/dist/") ||
      path.startsWith("node_modules/zod/")
  )
);
assert.ok(
  Object.values(graph.outputs).every((output) => output.imports.length === 0)
);
const evidence = {
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: packageDir,
    encoding: "utf8",
  }).trim(),
  packageDirty:
    execFileSync("git", ["status", "--porcelain", "--", "."], {
      cwd: packageDir,
      encoding: "utf8",
    }).trim() !== "",
  tarball,
  sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
  contents,
  consumer,
  publicRevision,
  browserInputs: Object.keys(graph.inputs),
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  join(artifacts, "verification.json"),
  JSON.stringify(evidence, null, 2) + "\n"
);
console.log(JSON.stringify(evidence, null, 2));
