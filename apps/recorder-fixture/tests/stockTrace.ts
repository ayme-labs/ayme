import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { fixtureProject } from "./fixtures";

const run = promisify(execFile);

/** The project whose Playwright is under test: another one when CI says so. */
const playwrightProject =
  process.env.AYME_RECORDER_PLAYWRIGHT_PROJECT ?? fixtureProject;

/** The folder of the Playwright installed in the project. */
async function installedPlaywright() {
  const require = createRequire(join(playwrightProject, "package.json"));
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    try {
      const manifest = require.resolve(`${name}/package.json`);
      return {
        folder: dirname(manifest),
        version: (
          JSON.parse(await readFile(manifest, "utf8")) as { version: string }
        ).version,
      };
    } catch {
      // Not installed under this name.
    }
  }
  throw new Error(`No Playwright is installed in ${playwrightProject}.`);
}

/**
 * The flag that names the phase of a snapshot to open: `--name` on Playwright
 * 1.62, `--phase` from 1.63.
 */
export const phaseFlag = (version: string) => {
  const [major, minor] = version.split(".").map(Number);
  return major === 1 && minor! <= 62 ? "--name" : "--phase";
};

/**
 * The stock `playwright trace` of the project's own Playwright, as a reader
 * runs it. It keeps what it has opened in the folder it runs in: one folder
 * for each use.
 */
export async function stockTraceTool() {
  const { folder, version } = await installedPlaywright();
  const cwd = await mkdtemp(join(tmpdir(), "ayme-recorder-stock-trace-"));
  const command = (...args: string[]) =>
    run(process.execPath, [join(folder, "cli.js"), "trace", ...args], {
      cwd,
      maxBuffer: 1 << 26,
    }).then(({ stdout }) => stdout);
  return {
    version,
    command,
    /** Opens the trace file. */
    open: (traceFile: string) => command("open", traceFile),
    /**
     * What `expression` gives on the page the snapshot at `position` holds,
     * in its "after" phase: every position a package gives is opened that way.
     */
    async evaluateAt(position: string, expression: string) {
      const output = await command(
        "snapshot",
        position,
        phaseFlag(version),
        "after",
        "eval",
        expression
      );
      const result = /### Result\n(.*)\n/.exec(output)?.[1];
      if (result === undefined) throw new Error(`No result in:\n${output}`);
      return JSON.parse(result) as unknown;
    },
    async close() {
      await command("close").catch(() => {});
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
