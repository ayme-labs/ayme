import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const script = fileURLToPath(
  new URL("./publish-packages.mjs", import.meta.url)
);

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

// Records its arguments, and fails for the tarball NPM_FAILS names.
const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NPM_CALLS, JSON.stringify(args) + "\\n");
if (args.includes(process.env.NPM_FAILS)) process.exit(1);
`;

/** Packs each manifest the way `pnpm pack` lays a tarball out. */
function packTarballs(root, packages) {
  const directory = path.join(root, "tarballs");
  fs.mkdirSync(directory);
  for (const manifest of packages) {
    const source = path.join(root, "source", manifest.name);
    fs.mkdirSync(path.join(source, "package"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "package/package.json"),
      JSON.stringify(manifest)
    );
    const file = `${manifest.name.replace("@", "").replace("/", "-")}.tgz`;
    execFileSync("tar", [
      "-czf",
      path.join(directory, file),
      "-C",
      source,
      "package",
    ]);
  }
  return directory;
}

/** Answers `<name>/<version>` with the status `answers` holds, or else 404. */
async function startRegistry(t, answers) {
  const server = http.createServer((request, response) => {
    const id = decodeURIComponent(request.url.slice(1));
    response.statusCode = answers[id] ?? 404;
    response.end("{}");
  });
  await new Promise((listening) => server.listen(0, "127.0.0.1", listening));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Runs the script on tarballs of `packages`, against a fake registry and a
 * fake `npm`. Returns its exit code, its output and the packages `npm publish`
 * received, in order.
 */
async function run(t, packages, { answers = {}, npmFails, version } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-packages-"));
  roots.push(root);
  const directory = packTarballs(root, packages);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), FAKE_NPM, { mode: 0o755 });
  const calls = path.join(root, "npm-calls");
  fs.writeFileSync(calls, "");

  const result = await promisify(execFile)(
    process.execPath,
    [script, directory, version ?? packages[0].version],
    {
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        NPM_CALLS: calls,
        NPM_FAILS: npmFails ? path.join(directory, npmFails) : "",
        npm_config_registry: await startRegistry(t, answers),
      },
    }
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (failure) => failure
  );

  const published = fs
    .readFileSync(calls, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { ...result, directory, published };
}

const pinned = (...names) =>
  Object.fromEntries(names.map((name) => [name, "0.2.0"]));

// The published set, with the dependencies its packed manifests carry.
const RELEASE = [
  { name: "@ayme-dev/angular", dependencies: pinned("@ayme-dev/ayme") },
  {
    name: "@ayme-dev/ayme",
    peerDependencies: pinned("@ayme-dev/inspector", "@ayme-dev/mcp"),
  },
  { name: "@ayme-dev/inspector", dependencies: pinned("@ayme-dev/ayme") },
  { name: "@ayme-dev/mcp" },
  { name: "@ayme-dev/react", dependencies: pinned("@ayme-dev/ayme") },
  { name: "@ayme-dev/svelte", dependencies: pinned("@ayme-dev/ayme") },
  { name: "@ayme-dev/unplugin-ayme", dependencies: pinned("@ayme-dev/ayme") },
  { name: "@ayme-dev/vue", dependencies: pinned("@ayme-dev/ayme") },
  { name: "@ayme-dev/webmcp" },
].map((manifest) => ({ ...manifest, version: "0.2.0" }));

const tarballNames = ({ published }) =>
  published.map(([, tarball]) => path.basename(tarball, ".tgz"));

test("publishes the main package first, then the rest by name", async (t) => {
  const result = await run(t, RELEASE);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(tarballNames(result), [
    "ayme-dev-ayme",
    "ayme-dev-angular",
    "ayme-dev-inspector",
    "ayme-dev-mcp",
    "ayme-dev-react",
    "ayme-dev-svelte",
    "ayme-dev-unplugin-ayme",
    "ayme-dev-vue",
    "ayme-dev-webmcp",
  ]);
});

test("publishes a package after the packages it depends on, whatever their names", async (t) => {
  const result = await run(t, [
    { name: "a-app", version: "1.0.0", dependencies: { "m-lib": "1.0.0" } },
    { name: "m-lib", version: "1.0.0", dependencies: { "z-base": "1.0.0" } },
    { name: "z-base", version: "1.0.0" },
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(tarballNames(result), ["z-base", "m-lib", "a-app"]);
});

test("publishes public packages without running their scripts and without a dist-tag", async (t) => {
  const result = await run(t, [{ name: "lib", version: "1.0.0" }]);
  assert.deepEqual(result.published, [
    [
      "publish",
      path.join(result.directory, "lib.tgz"),
      "--access",
      "public",
      "--ignore-scripts",
    ],
  ]);
});

test("skips versions the registry already has and publishes the others", async (t) => {
  const result = await run(t, RELEASE, {
    answers: {
      "@ayme-dev/ayme/0.2.0": 200,
      "@ayme-dev/react/0.2.0": 200,
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const names = tarballNames(result);
  assert.equal(names.length, RELEASE.length - 2);
  assert.ok(!names.includes("ayme-dev-ayme"));
  assert.ok(!names.includes("ayme-dev-react"));
  assert.match(result.stdout, /Skipping @ayme-dev\/ayme@0\.2\.0/);
});

test("succeeds without publishing when the registry has every version", async (t) => {
  const answers = Object.fromEntries(
    RELEASE.map(({ name, version }) => [`${name}/${version}`, 200])
  );
  const result = await run(t, RELEASE, { answers });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.published, []);
});

test("fails on any other registry answer and publishes nothing further", async (t) => {
  const result = await run(t, RELEASE, {
    answers: { "@ayme-dev/angular/0.2.0": 500 },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /answered 500 for @ayme-dev\/angular@0\.2\.0/);
  assert.deepEqual(tarballNames(result), ["ayme-dev-ayme"]);
});

test("fails when a publish fails and stops there", async (t) => {
  const result = await run(t, RELEASE, { npmFails: "ayme-dev-angular.tgz" });
  assert.notEqual(result.code, 0);
  assert.deepEqual(tarballNames(result), ["ayme-dev-ayme", "ayme-dev-angular"]);
});

test("refuses tarballs at another version before publishing anything", async (t) => {
  const result = await run(t, RELEASE, { version: "0.3.0" });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected every tarball at 0\.3\.0/);
  assert.deepEqual(result.published, []);
});

test("refuses one package left at another version", async (t) => {
  const stale = { name: "@ayme-dev/webmcp", version: "0.1.0" };
  const result = await run(t, [...RELEASE.slice(0, -1), stale], {
    version: "0.2.0",
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /@ayme-dev\/webmcp@0\.1\.0/);
  assert.deepEqual(result.published, []);
});
