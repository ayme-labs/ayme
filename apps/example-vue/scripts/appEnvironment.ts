import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

/** The directory of this app, where Vite reads its `.env` files. */
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The model key the dev server's Decision Endpoint reads in `mode`. */
export function readModelKey(mode = "development"): string | undefined {
  return loadEnv(mode, appRoot, "").AYME_OPENROUTER_API_KEY || undefined;
}

/** Set to `1` by `scripts/goal-runs.ts` for the Playwright run it spawns; the
 *  live lane records goal runs only then. */
export const goalRunsVariable = "AYME_GOAL_RUNS";
