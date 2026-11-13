import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import type * as PlaywrightCore from "playwright-core";

import range from "../../../playwright-range.json";
import { RecorderStartError } from "../../session/domain";

/** What the adapter uses of Playwright's module. */
export type Playwright = Pick<typeof PlaywrightCore, "chromium">;

/** The Playwright versions the recorder supports, from the one place that
 * states them: `playwright-range.json` beside this package. */
export const SUPPORTED_PLAYWRIGHT = range;

/** Where a version stands against the supported range, by its minor. */
export function placeInRange(version: string): "below" | "within" | "above" {
  const minor = (stated: string) => {
    const [major = 0, minor = 0] = stated.split(".").map(Number);
    return major * 1000 + minor;
  };
  if (minor(version) < minor(range.floor)) return "below";
  return minor(version) > minor(range.lastVerified) ? "above" : "within";
}

/** The range as a sentence names it. */
export const rangeText = `Playwright ${range.floor} or newer, and is verified on ${range.floor} to ${range.lastVerified}`;

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
      if (!folder) continue;
      const { version } = JSON.parse(
        readFileSync(join(folder, "package.json"), "utf8")
      ) as { version: string };
      if (placeInRange(version) === "below")
        return Effect.fail(
          new RecorderStartError(
            "playwright-too-old",
            `${projectDir} has Playwright ${version}. The recorder needs ${rangeText}: update the project's Playwright, for example with "npm install -D @playwright/test@latest".`
          )
        );
      return Effect.succeed(requireFile(folder) as Playwright);
    }
    return Effect.fail(
      new RecorderStartError(
        "playwright-not-found",
        `No Playwright is installed in ${projectDir}. The recorder uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".`
      )
    );
  });
