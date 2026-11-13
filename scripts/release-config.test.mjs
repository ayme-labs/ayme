import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
}

const config = readJson("release-please-config.json");
const manifest = readJson(".release-please-manifest.json");
const linked = config.plugins.find(({ type }) => type === "linked-versions");

const packagePaths = fs
  .readdirSync(path.join(repoRoot, "packages"))
  .map((dir) => `packages/${dir}`)
  .filter((dir) => fs.existsSync(path.join(repoRoot, dir, "package.json")));
const isPrivate = (dir) => readJson(`${dir}/package.json`).private === true;
const publishedPaths = packagePaths.filter((dir) => !isPrivate(dir)).sort();

test("Release Please releases every package that is not private, and the manifest names the same packages", () => {
  const configured = Object.keys(config.packages).sort();
  for (const dir of publishedPaths) assert.ok(configured.includes(dir), dir);
  assert.deepEqual(Object.keys(manifest).sort(), configured);
});

// A private package may be named here to be ready for release: it is held
// back until its package.json drops `"private": true`, which is the one change
// that releases it. The packed-consumer check packs it but keeps its tarball
// out of what the release publishes.
test("a package named in the release configuration that is private is a package of this repository", () => {
  for (const dir of Object.keys(config.packages))
    assert.ok(packagePaths.includes(dir), dir);
});

test("every released package is in the linked group", () => {
  const components = Object.values(config.packages).map(
    ({ component }) => component
  );
  assert.deepEqual([...linked.components].sort(), components.sort());
});

test("the release pull request title passes commit lint", () => {
  // With its own merge on, the plugin names the pull request chore(main): ...,
  // and main is not a commit scope.
  assert.equal(linked.merge, false);
  const title = config["group-pull-request-title-pattern"].replace(
    "${branch}",
    "main"
  );
  assert.equal(title, "chore: release main");
  execFileSync("pnpm", ["exec", "commitlint"], {
    cwd: repoRoot,
    input: `${title}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
});
