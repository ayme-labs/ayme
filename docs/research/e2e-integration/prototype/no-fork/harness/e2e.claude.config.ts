import {
  agentSolver,
  aymeAvailability,
  aymeExecutor,
  aymeTools,
  claudeCodeDriver,
} from "../src/index.ts";
import {
  config,
  COUNTER_POM_FILE,
  dirs,
  engine,
  POM_FILE,
} from "./base.config.ts";

/** Claude Code, one session per test: `SPIKE_ARM=stock|ayme`. */
const arm = process.env.SPIKE_ARM === "ayme" ? "ayme" : "stock";
const name = process.env.SPIKE_CONFIG_NAME ?? `claude-${arm}`;
const tokenFile = process.env.SPIKE_CLAUDE_TOKEN_FILE;
if (tokenFile === undefined) throw new Error("set SPIKE_CLAUDE_TOKEN_FILE");
const multi = process.env.SPIKE_TESTS?.includes("multi") === true;
const pomFiles = multi ? [POM_FILE, COUNTER_POM_FILE] : [POM_FILE];

export default config(name, {
  executor: aymeExecutor({
    tools: arm === "ayme" ? aymeTools({ engine, files: pomFiles }) : {},
    ...(arm === "ayme" && process.env.SPIKE_AVAILABILITY === "1"
      ? { availability: aymeAvailability({ engine, files: pomFiles }) }
      : {}),
    storeDir: dirs(name).ayme,
    solver: agentSolver(
      claudeCodeDriver({
        tokenFile,
        ...(process.env.SPIKE_CLAUDE_MODEL === undefined
          ? {}
          : { model: process.env.SPIKE_CLAUDE_MODEL }),
        ...(process.env.SPIKE_LOG === undefined
          ? {}
          : { stderrFile: `${process.env.SPIKE_LOG}.stderr` }),
      }),
      { offerPageObjects: arm === "ayme" }
    ),
  }),
});
