import { aymeAvailability, aymeExecutor, aymeTools } from "@ayme-dev/e2e";
import { config, dirs, engine, POM_FILES } from "./base.config.ts";
import { scriptedSolver } from "./scripted-solver.ts";

/**
 * The model-free stand-in: `AYME_E2E_ARM=stock|ayme`. It checks the tests,
 * the tools and the store before any paid run.
 */
const arm = process.env.AYME_E2E_ARM === "ayme" ? "ayme" : "stock";
const name = process.env.AYME_E2E_CONFIG_NAME ?? `scripted-${arm}`;

export default config(name, {
  executor: aymeExecutor({
    tools: arm === "ayme" ? aymeTools({ engine, files: POM_FILES }) : {},
    storeDir: dirs(name).ayme,
    solver: scriptedSolver(arm),
    ...(process.env.AYME_E2E_ROUTE === "direct"
      ? { route: "direct" as const }
      : {}),
    ...(arm === "ayme" && process.env.AYME_E2E_AVAILABILITY === "1"
      ? { availability: aymeAvailability({ engine, files: POM_FILES }) }
      : {}),
  }),
});
