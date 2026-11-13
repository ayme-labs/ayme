import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import type * as PlaywrightCore from "playwright-core";

import { RecorderStartError } from "../../session/domain";

/** What the adapter uses of Playwright's module. */
export type Playwright = Pick<typeof PlaywrightCore, "chromium">;

// The names a project installs Playwright under. Each exports the same
// browser types.
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

/**
 * The Playwright the project has installed: resolved from the project
 * folder, never from the engine's own dependencies (ADR-0052).
 */
export const loadProjectPlaywright = (
  projectDir: string
): Effect.Effect<Playwright, RecorderStartError> =>
  Effect.suspend(() => {
    for (const name of PLAYWRIGHT_PACKAGES) {
      const folder = installedIn(projectDir, name);
      if (folder) return Effect.succeed(requireFile(folder) as Playwright);
    }
    return Effect.fail(
      new RecorderStartError(
        "playwright-not-found",
        `No Playwright is installed in ${projectDir}. The recorder uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".`
      )
    );
  });

/**
 * The command line of the project's Playwright, `cli.js`: it runs the same
 * `playwright trace` and the same `playwright install` the project's own
 * `npx playwright` does. Undefined when none is installed.
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
