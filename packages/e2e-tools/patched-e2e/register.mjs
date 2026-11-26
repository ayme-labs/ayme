// Patches e2e in this process only: a module hook hands Node the patched
// source of each file the patches change, as it loads it. The files on disk
// stay the published ones, so a process started without this hook, as the
// study's first two arms are, runs e2e as published. `bin.mjs` loads it into
// the runner and, through NODE_OPTIONS, into every process the runner starts.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyHunks, loadPatches } from "./patches.mjs";

const patches = loadPatches();
/** @type {Map<string, string>} A checked package root, by the root. */
const checked = new Map();

/**
 * The patched source of `file`, or undefined when no patch changes it.
 * @param {string} file
 * @param {string} source
 */
function patched(file, source) {
  for (const { name, version, files } of patches) {
    const marker = `${path.sep}node_modules${path.sep}${name.replace("/", path.sep)}${path.sep}`;
    const at = file.lastIndexOf(marker);
    if (at === -1) continue;
    const root = file.slice(0, at + marker.length);
    const hunks = files.get(file.slice(root.length).split(path.sep).join("/"));
    if (!hunks) return undefined;
    if (!checked.has(root)) {
      const installed = JSON.parse(
        readFileSync(path.join(root, "package.json"), "utf8")
      ).version;
      if (installed !== version)
        throw new Error(
          `patched e2e: the patch is for ${name} ${version}, but ${installed} is installed; redo it (packages/e2e-tools/README.md)`
        );
      checked.set(root, installed);
    }
    // The patched module marks itself as it runs, so `assertPatchedE2e` can tell
    // a file loaded through this hook from one loaded before it.
    return `${applyHunks(source, hunks, `${name}/${file.slice(root.length)}`)}\n;(globalThis[Symbol.for("@ayme-dev/e2e-tools.patched-files")] ??= new Set()).add(${JSON.stringify(file)});\n`;
  }
  return undefined;
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith("file:") || loaded.source == null) return loaded;
    const source =
      typeof loaded.source === "string"
        ? loaded.source
        : new TextDecoder().decode(loaded.source);
    const changed = patched(fileURLToPath(url), source);
    return changed === undefined ? loaded : { ...loaded, source: changed };
  },
});

// What `assertPatchedE2e` and `assertUnpatchedE2e` read, in this process: the
// packages the patches change and the files of each.
globalThis[Symbol.for("@ayme-dev/e2e-tools.patched-e2e")] = patches.map(
  ({ name, version, files }) => ({ name, version, files: [...files.keys()] })
);
