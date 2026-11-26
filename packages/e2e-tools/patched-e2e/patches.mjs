// The patches in ../patches, applied to an installed file's source as Node
// loads it. Each hunk must match the published file exactly, so an upgraded
// e2e fails loudly instead of running a patch that half applies.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../patches/", import.meta.url));

/**
 * @typedef {{ oldStart: number, oldLines: string[], newLines: string[] }} Hunk
 * @typedef {{ name: string, version: string, files: Map<string, Hunk[]> }} PackagePatch
 */

/**
 * The patches, one per package, named as pnpm names them:
 * `@e2e-dev__core@0.25.0.patch` patches `@e2e-dev/core` 0.25.0.
 * @returns {PackagePatch[]}
 */
export function loadPatches() {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".patch"))
    .map((file) => {
      const named = /^(.+)@([^@]+)\.patch$/.exec(file);
      if (!named)
        throw new Error(
          `patched e2e: ${file} is not named <package>@<version>.patch`
        );
      return {
        name: named[1].replace("__", "/"),
        version: named[2],
        files: parse(readFileSync(path.join(dir, file), "utf8"), file),
      };
    });
}

/**
 * The hunks of a unified diff, by the file each changes (`dist/agent/act.js`).
 * @param {string} text
 * @param {string} origin
 * @returns {Map<string, Hunk[]>}
 */
function parse(text, origin) {
  /** @type {Map<string, Hunk[]>} */
  const files = new Map();
  /** @type {Hunk[] | undefined} */
  let hunks;
  /** @type {Hunk | undefined} */
  let hunk;
  for (const line of text.split("\n")) {
    const file = /^diff --git a\/(\S+) b\//.exec(line);
    if (file) {
      files.set(file[1], (hunks = []));
      hunk = undefined;
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      if (!hunks)
        throw new Error(`patched e2e: ${origin} has a hunk outside a file`);
      hunks.push(
        (hunk = { oldStart: Number(header[1]), oldLines: [], newLines: [] })
      );
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith(" ")) {
      hunk.oldLines.push(line.slice(1));
      hunk.newLines.push(line.slice(1));
    } else if (line.startsWith("-")) hunk.oldLines.push(line.slice(1));
    else if (line.startsWith("+")) hunk.newLines.push(line.slice(1));
    // "\ No newline at end of file", the blank line that ends the diff, and
    // the next file's header lines carry no change.
    else hunk = undefined;
  }
  return files;
}

/**
 * `source` with `hunks` applied, each where the diff says it is.
 * @param {string} source
 * @param {Hunk[]} hunks
 * @param {string} where
 */
export function applyHunks(source, hunks, where) {
  const lines = source.split("\n");
  let shift = 0;
  for (const { oldStart, oldLines, newLines } of hunks) {
    // A hunk that removes nothing and keeps no context inserts after its line.
    const at = oldStart - (oldLines.length === 0 ? 0 : 1) + shift;
    const found = lines.slice(at, at + oldLines.length);
    if (
      found.length !== oldLines.length ||
      found.some((line, i) => line !== oldLines[i])
    )
      throw new Error(
        `patched e2e: ${where} is not the file its patch was made for (the hunk at line ${oldStart} does not match)`
      );
    lines.splice(at, oldLines.length, ...newLines);
    shift += newLines.length - oldLines.length;
  }
  return lines.join("\n");
}
