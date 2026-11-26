import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import type * as PlaywrightCore from "playwright-core";

import { BrowserError } from "./browserError";
import { placeInRange } from "./playwrightRange";

export type Playwright = Pick<typeof PlaywrightCore, "chromium">;

/** The Playwright a project has installed, with its version. */
export type ProjectPlaywright = {
  readonly playwright: Playwright;
  readonly version: string;
};

// The names a project installs Playwright under, in the order they are
// looked for. Each exports the same browser types.
const PLAYWRIGHT_PACKAGES = [
  "playwright",
  "@playwright/test",
  "playwright-core",
];

const requireFile = createRequire(import.meta.url);

/**
 * The folder of a package installed in the project: in the `node_modules` of
 * the project folder or of a folder above it. Node's own resolver is not
 * used: it also searches `NODE_PATH`, which a package manager points at its
 * own store, so a project without Playwright would get someone else's.
 */
function installedIn(projectDir: string, name: string): string | undefined {
  for (let dir = resolve(projectDir); ; dir = dirname(dir)) {
    const folder = join(dir, "node_modules", name);
    if (existsSync(folder)) return folder;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The folder of the Playwright installed in the project, under the first of
 * its names found. */
function installedPlaywright(projectDir: string): string | undefined {
  for (const name of PLAYWRIGHT_PACKAGES) {
    const folder = installedIn(projectDir, name);
    if (folder) return folder;
  }
  return undefined;
}

/**
 * The Playwright the project has installed: resolved from the project
 * folder, never from ayme's own dependencies (ADR-0052). One older than the
 * supported range is refused; a newer one is not.
 */
export const projectPlaywright = (
  projectDir: string
): Effect.Effect<ProjectPlaywright, BrowserError> =>
  Effect.gen(function* () {
    const folder = installedPlaywright(projectDir);
    if (!folder)
      return yield* Effect.fail(
        new BrowserError(
          "no Playwright in the project",
          `No Playwright is installed in ${projectDir}.`
        )
      );
    // A broken install, such as one whose entry file is gone, is no
    // Playwright either: the remedy is to install it again.
    const load = <A>(read: () => A) =>
      Effect.try({
        try: read,
        catch: (cause) =>
          new BrowserError(
            "no Playwright in the project",
            `The Playwright at ${folder} cannot be loaded (${String(cause).split("\n")[0]}).`
          ),
      });
    const { version } = yield* load(
      () =>
        JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
          version: string;
        }
    );
    if (placeInRange(version) === "below")
      return yield* Effect.fail(
        new BrowserError(
          "unsupported Playwright version",
          `${projectDir} has Playwright ${version}.`
        )
      );
    const playwright = yield* load(() => requireFile(folder) as Playwright);
    return { playwright, version };
  });

/**
 * The command line of the project's Playwright, `cli.js`: it runs the same
 * commands the project's own `npx playwright` does. Undefined when none is
 * installed.
 */
export function projectPlaywrightCli(projectDir: string): string | undefined {
  for (const name of PLAYWRIGHT_PACKAGES) {
    const folder = installedIn(projectDir, name);
    if (folder) {
      const cli = join(folder, "cli.js");
      if (existsSync(cli)) return cli;
    }
  }
  return undefined;
}
