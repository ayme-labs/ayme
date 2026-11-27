#!/usr/bin/env node
// `e2e-patched <args>`: e2e's own CLI, with e2e patched in this process and in
// its test workers, and nowhere else. It runs the e2e that the current
// directory's project resolves, and only with a config that asks for the
// patches: e2e's default config may be a baseline arm's.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The `--config` e2e will load: the last one given, as its CLI takes it. */
function configArg(args) {
  let config;
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === "--config") config = args[at + 1];
    else if (args[at].startsWith("--config="))
      config = args[at].slice("--config=".length);
  }
  return config;
}

const config = configArg(process.argv.slice(2));
const source =
  config !== undefined && existsSync(config)
    ? readFileSync(config, "utf8")
    : "";
if (!/\bassertPatchedE2e\s*\(/.test(source)) {
  process.stderr.write(
    `e2e-patched: give it --config with a config that calls assertPatchedE2e (@ayme-dev/e2e-tools)${config === undefined ? "" : `; ${config} does not`}. Any other config may be a baseline arm's, which runs on e2e as published.\n`
  );
  process.exit(2);
}

const register = new URL("./register.mjs", import.meta.url).href;
await import(register);
// The patch of e2e's worker handle (`patches/e2e@*.patch`) passes these to
// the test workers it forks; the app server and the ACP agent, which the
// runner and workers spawn, do not inherit them.
globalThis[Symbol.for("@ayme-dev/e2e-tools.workerExecArgv")] = [
  "--import",
  register,
];

/** The manifest of the package `file` belongs to, found from its folder up. */
function manifestOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed.name === "e2e") return { dir, bin: parsed.bin };
    }
    if (path.dirname(dir) === dir)
      throw new Error(`e2e-patched: no e2e package above ${file}`);
  }
}

const e2e = manifestOf(
  createRequire(path.join(process.cwd(), "package.json")).resolve("e2e")
);
const bin = typeof e2e.bin === "string" ? e2e.bin : e2e.bin.e2e;
await import(pathToFileURL(path.join(e2e.dir, bin)).href);
