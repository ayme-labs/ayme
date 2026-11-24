/**
 * Keeps the lab app folder, the agent's working root, as the next run's agent
 * must find it. Gitignored files do not count. Before a run the checkout must
 * be clean; after it, files the agent left behind are moved out, never deleted.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { formbricksRoot, labRoot, repoRoot } from "./paths.ts";

/** Paths relative to the lab app folder. */
export type LabChanges = {
  /** Untracked and not ignored: files the agent created. */
  untracked: string[];
  /** Tracked files that were modified, added, deleted or renamed. */
  modified: string[];
};

export type PorcelainEntry = { status: string; path: string };

/** The entries of `git status --porcelain=v1 -z`. */
export function parsePorcelain(output: string): PorcelainEntry[] {
  const fields = output.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.push({ status, path: field.slice(3) });
    // A rename or copy is followed by its source path.
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return entries;
}

/** Splits entries into the agent's new files and changes to tracked files, with paths made relative to the lab app folder. */
export function classifyEntries(
  entries: PorcelainEntry[],
  toLabPath: (gitPath: string) => string
): LabChanges {
  const changes: LabChanges = { untracked: [], modified: [] };
  for (const { status, path: gitPath } of entries) {
    if (status === "!!") continue;
    (status === "??" ? changes.untracked : changes.modified).push(
      toLabPath(gitPath)
    );
  }
  return changes;
}

function gitStatus(cwd: string, args: string[]) {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...args],
    { cwd, encoding: "utf8" }
  );
  if (result.status !== 0)
    throw new Error(
      `git status failed in ${cwd}: ${result.stderr.trim() || result.error?.message || result.status}`
    );
  return parsePorcelain(result.stdout);
}

/**
 * The lab app folder's changes: this repository's view of it, and the
 * Formbricks submodule's own, which this repository cannot see into.
 */
export function readLabChanges(): LabChanges {
  const own = classifyEntries(
    gitStatus(repoRoot, [
      "--ignore-submodules=dirty",
      "--",
      path.relative(repoRoot, labRoot),
    ]),
    (gitPath) => path.relative(labRoot, path.join(repoRoot, gitPath))
  );
  const submodule = classifyEntries(gitStatus(formbricksRoot, []), (gitPath) =>
    path.relative(labRoot, path.join(formbricksRoot, gitPath))
  );
  return {
    untracked: [...own.untracked, ...submodule.untracked],
    modified: [...own.modified, ...submodule.modified],
  };
}

/** Moves the files into `destination`, keeping their relative paths. Nothing is deleted. */
export async function moveFiles(
  files: string[],
  destination: string,
  root: string = labRoot
) {
  for (const file of files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(root, file), target);
  }
}
