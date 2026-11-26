#!/usr/bin/env node
// `e2e-patched <args>`: e2e's own CLI, with e2e patched in this process and
// in every process it starts (its test workers get NODE_OPTIONS), and nowhere
// else. It runs the e2e that the current directory's project resolves.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const register = new URL("./register.mjs", import.meta.url).href;
await import(register);
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import="${register}"`]
  .filter(Boolean)
  .join(" ");

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
