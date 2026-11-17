/**
 * Keeps the lab app folder, the agent's working root, as the next run's agent
 * must find it. Gitignored files do not count. Before a run the checkout must
 * be clean; after it, files the agent left behind are moved out, never deleted.
 * An attempt that is thrown away also gets its changes to tracked files saved
 * as a patch and undone, so that the repeat starts from the checkout as committed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { withoutClaudeVariables } from "./claude.ts";
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
    { cwd, encoding: "utf8", env: withoutClaudeVariables(process.env) }
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

const git = (cwd: string, args: string[]) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: withoutClaudeVariables(process.env),
  });

/**
 * Saves the diff of a tracked file against HEAD under `destination` as
 * `<file>.diff`, then restores the file. The diff is written first: when git
 * cannot produce it or the restore fails, the file stays as the agent left it.
 */
async function saveAndRestore(file: string, destination: string, root: string) {
  // The file may be gone, or in the Formbricks submodule: ask the repository that holds its folder.
  let folder = path.dirname(path.join(root, file));
  while (!existsSync(folder)) folder = path.dirname(folder);
  const top = git(folder, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error(`${file} is in no git repository.`);
  const repository = top.stdout.trim();
  // Git reports real paths, which differ from `root` where a folder on the way is a symlink.
  const relative = path.relative(
    repository,
    path.join(
      realpathSync(folder),
      path.relative(folder, path.join(root, file))
    )
  );
  const diff = git(repository, ["diff", "HEAD", "--binary", "--", relative]);
  if (diff.status !== 0)
    throw new Error(`git diff failed for ${file}: ${diff.stderr.trim()}`);
  const target = path.join(destination, `${file}.diff`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, diff.stdout);
  const restore = git(repository, ["checkout", "HEAD", "--", relative]);
  if (restore.status !== 0)
    throw new Error(
      `git checkout failed for ${file}: ${restore.stderr.trim()}`
    );
}

/**
 * The attempt's own cleanup: sets aside what the agent left in the lab app
 * folder, whichever way it ended. `before` is the state when the agent was
 * started, and only what is new since then is touched: a file or change that
 * was already there is not the attempt's.
 *
 * Files the agent created are moved into `destination`. Changes to tracked
 * files are left for a person to inspect, unless the attempt is thrown away
 * (`discard`): then each is saved as a patch in `destination` and undone, so
 * the run can be repeated. Returns what was new.
 */
export async function setAsideAttempt(options: {
  before: LabChanges;
  destination: string;
  discard: boolean;
  read?: () => LabChanges;
  root?: string;
}): Promise<LabChanges> {
  const { before, destination, discard, read = readLabChanges } = options;
  const root = options.root ?? labRoot;
  const after = read();
  const changes: LabChanges = {
    untracked: after.untracked.filter(
      (file) => !before.untracked.includes(file)
    ),
    modified: after.modified.filter((file) => !before.modified.includes(file)),
  };
  await moveFiles(changes.untracked, destination, root);
  if (discard)
    for (const file of changes.modified)
      await saveAndRestore(file, destination, root);
  return changes;
}
