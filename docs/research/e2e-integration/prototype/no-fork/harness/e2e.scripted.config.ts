import { aymeAvailability, aymeExecutor, aymeTools } from "../src/index.ts";
import { config, dirs, engine, POM_FILE } from "./base.config.ts";
import { scriptedSolver } from "./scripted-solver.ts";

/** The model-free proof: `SPIKE_ARM=stock|ayme`. */
const arm = process.env.SPIKE_ARM === "ayme" ? "ayme" : "stock";
const name = process.env.SPIKE_CONFIG_NAME ?? `scripted-${arm}`;

export default config(name, {
  executor: aymeExecutor({
    tools: arm === "ayme" ? aymeTools({ engine, files: [POM_FILE] }) : {},
    storeDir: dirs(name).ayme,
    solver: scriptedSolver(arm),
    ...(process.env.SPIKE_ROUTE === "direct"
      ? { route: "direct" as const }
      : {}),
    ...(arm === "ayme" && process.env.SPIKE_AVAILABILITY === "1"
      ? { availability: aymeAvailability({ engine, files: [POM_FILE] }) }
      : {}),
  }),
});
