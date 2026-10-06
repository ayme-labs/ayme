import { aymeTools } from "./ayme-tools.ts";
import { config, COUNTER_POM_FILE, engine, POM_FILE } from "./base.config.ts";
import { claudeCodeExecutor } from "./claude-code-executor.ts";

/** Claude Code through the Agent SDK, one session per test: `SPIKE_ARM=stock|ayme` picks the arm. */
const arm = process.env.SPIKE_ARM === "ayme" ? "ayme" : "stock";

export default config(process.env.SPIKE_CONFIG_NAME ?? `claude-${arm}`, {
  executor: claudeCodeExecutor({
    arm,
    // The multi-act suite also acts on the counter, so it offers that page object too.
    ...(arm === "ayme"
      ? {
          tools: aymeTools({
            engine,
            files: process.env.SPIKE_TESTS?.includes("multi")
              ? [POM_FILE, COUNTER_POM_FILE]
              : [POM_FILE],
          }),
        }
      : {}),
  }),
});
