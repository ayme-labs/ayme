import { aymeTools } from "./ayme-tools.ts";
import { config, engine, POM_FILE } from "./base.config.ts";
import { scriptedExecutor } from "./scripted-executor.ts";

/** The model-free mechanics run: `SPIKE_ARM=stock|ayme` picks the arm. */
const arm = process.env.SPIKE_ARM === "ayme" ? "ayme" : "stock";

export default config(`scripted-${arm}`, {
  executor: scriptedExecutor(
    arm,
    arm === "ayme" ? aymeTools({ engine, files: [POM_FILE] }) : {}
  ),
});
