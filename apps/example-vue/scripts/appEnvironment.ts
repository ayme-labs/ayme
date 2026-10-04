import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

import type { CreateDecisionEndpointOptions } from "@ayme-dev/ayme/server";

/** The directory of this app, where Vite reads its `.env` files. */
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

type ModelKey = Pick<CreateDecisionEndpointOptions, "provider" | "apiKey">;

/** Every model key set in `mode`, a TypeSafe key before an OpenRouter key. */
export function readModelKeys(mode = "development"): ModelKey[] {
  const env = loadEnv(mode, appRoot, "");
  const keys: ModelKey[] = [];
  if (env.AYME_TYPESAFE_API_KEY)
    keys.push({ provider: "typesafe", apiKey: env.AYME_TYPESAFE_API_KEY });
  if (env.AYME_OPENROUTER_API_KEY)
    keys.push({ provider: "openrouter", apiKey: env.AYME_OPENROUTER_API_KEY });
  return keys;
}

/** The provider and key the dev server's Decision Endpoint uses in `mode`:
 *  a TypeSafe key when one is set, otherwise an OpenRouter key. */
export function readDecisionProvider(
  mode = "development"
): ModelKey | undefined {
  return readModelKeys(mode)[0];
}

/** Set to `1` by `scripts/goal-runs.ts` for the Playwright run it spawns; the
 *  live lane records goal runs only then. */
export const goalRunsVariable = "AYME_GOAL_RUNS";
