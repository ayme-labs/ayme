import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

import type { CreateDecisionEndpointOptions } from "@ayme-dev/ayme/server";

/** The directory of this app, where Vite reads its `.env` files. */
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The provider and key the dev server's Decision Endpoint uses in `mode`:
 *  a TypeSafe key when one is set, otherwise an OpenRouter key. */
export function readDecisionProvider(
  mode = "development"
): Pick<CreateDecisionEndpointOptions, "provider" | "apiKey"> | undefined {
  const env = loadEnv(mode, appRoot, "");
  if (env.AYME_TYPESAFE_API_KEY)
    return { provider: "typesafe", apiKey: env.AYME_TYPESAFE_API_KEY };
  if (env.AYME_OPENROUTER_API_KEY)
    return { provider: "openrouter", apiKey: env.AYME_OPENROUTER_API_KEY };
  return undefined;
}

/** Set to `1` by `scripts/goal-runs.ts` for the Playwright run it spawns; the
 *  live lane records goal runs only then. */
export const goalRunsVariable = "AYME_GOAL_RUNS";
