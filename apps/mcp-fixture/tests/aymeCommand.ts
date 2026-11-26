import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAyme, type AymeRun } from "@ayme-dev/cli/testing";
import { test as base, expect } from "@playwright/test";

export { expect };

/** Whether a process with `pid` exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The processes whose command line names `text`. */
function processesNaming(text: string): number[] {
  if (process.platform === "linux")
    return readdirSync("/proc").flatMap((name) => {
      try {
        return /^\d+$/.test(name) &&
          readFileSync(`/proc/${name}/cmdline`, "utf8").includes(text)
          ? [Number(name)]
          : [];
      } catch {
        return [];
      }
    });
  return execFileSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.includes(text))
    .map((line) => Number.parseInt(line, 10));
}

const signal = (pids: number[], name: NodeJS.Signals) => {
  for (const pid of pids)
    try {
      process.kill(pid, name);
    } catch {
      // Already gone.
    }
};

/**
 * Ends every process the test's `ayme` runs started, whether or not it got
 * as far as its record: each names the test's own temporary folder, the
 * background process in its socket's path and Chromium in its profile's.
 * Each is first ended as `ayme close` would, so its browser closes too, and
 * whatever is left after a while, behind a start that does not end, is
 * killed.
 */
async function endProcessesIn(folder: string): Promise<void> {
  signal(processesNaming(folder), "SIGTERM");
  try {
    await expect
      .poll(() => processesNaming(folder), { timeout: 10_000 })
      .toEqual([]);
  } catch {
    signal(processesNaming(folder), "SIGKILL");
  }
}

export const test = base.extend<{
  /** A project folder of the test's own, inside the fixture, so the
   * project's Playwright is the fixture's. */
  project: string;
  /** Runs the built `ayme` command in the project. */
  ayme: (...args: string[]) => Promise<AymeRun>;
  /** Runs the built `ayme` command in the folder `cwd`, with a cache folder
   * and a temporary folder of the test's own, so it never finds another
   * test's Session. Every process it started is ended with the test, and
   * the folders are removed. */
  aymeIn: (cwd: string, ...args: string[]) => Promise<AymeRun>;
  /** The process of the project's Session, read from the newest record it
   * keeps in the cache folder; undefined when it has none. */
  sessionProcess: () => number | undefined;
}>({
  // Playwright reads a fixture's dependencies from its first parameter,
  // which must be a pattern.
  // eslint-disable-next-line no-empty-pattern
  project: async ({}, use, testInfo) => {
    const project = testInfo.outputPath("project");
    await mkdir(project, { recursive: true });
    await use(project);
    await rm(project, { recursive: true, force: true });
  },
  // eslint-disable-next-line no-empty-pattern
  sessionProcess: async ({}, use, testInfo) => {
    const sessions = testInfo.outputPath("cache", "sessions");
    await use(() => {
      let folders: string[];
      try {
        folders = readdirSync(sessions);
      } catch {
        return undefined;
      }
      const claims = folders.map((name) => join(sessions, name));
      const newest = claims
        .flatMap((claim) =>
          readdirSync(claim)
            .filter((name) => /^\d+\.json$/.test(name))
            .map((name) => ({ claim, generation: Number.parseInt(name, 10) }))
        )
        .sort((a, b) => b.generation - a.generation)[0];
      if (newest === undefined) return undefined;
      return (
        JSON.parse(
          readFileSync(join(newest.claim, `${newest.generation}.json`), "utf8")
        ) as { pid: number }
      ).pid;
    });
  },
  // eslint-disable-next-line no-empty-pattern
  aymeIn: async ({}, use, testInfo) => {
    const cache = testInfo.outputPath("cache");
    // A short folder: a Session's socket lives in it, and a local socket's
    // path is short.
    const temporary = realpathSync(await mkdtemp(join(tmpdir(), "ayme-e2e-")));
    const env = { ...process.env, AYME_CACHE_DIR: cache, TMPDIR: temporary };
    try {
      await use((cwd, ...args) => runAyme(args, { cwd, env }));
    } finally {
      await endProcessesIn(temporary);
      await rm(temporary, { recursive: true, force: true });
      await rm(cache, { recursive: true, force: true });
    }
  },
  ayme: async ({ project, aymeIn }, use) => {
    await use((...args) => aymeIn(project, ...args));
  },
});
