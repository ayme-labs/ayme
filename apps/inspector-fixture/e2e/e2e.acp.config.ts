import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acpDriver,
  agentSolver,
  aymeAvailability,
  aymeExecutor,
  aymeTools,
  type AcpDriverOptions,
} from "@ayme-dev/e2e";
import { config, dirs, engine, POM_FILES } from "./base.config.ts";

/**
 * An ACP agent, one session per test. `AYME_E2E_AGENT=claude|cursor` (Claude
 * by default), `AYME_E2E_ARM=stock|ayme` (stock by default), `AYME_E2E_MODEL`
 * overrides the agent's model. Claude uses the machine's own `claude auth
 * login`: no token file, no env injected into the adapter.
 */
const agent = process.env.AYME_E2E_AGENT ?? "claude";
if (agent !== "claude" && agent !== "cursor")
  throw new Error("set AYME_E2E_AGENT=claude|cursor");
const arm = process.env.AYME_E2E_ARM === "ayme" ? "ayme" : "stock";
const name = process.env.AYME_E2E_CONFIG_NAME ?? `acp-${agent}-${arm}`;
const model = process.env.AYME_E2E_MODEL;
// The live-tool filter is on for the ayme arm unless switched off.
const availability =
  arm === "ayme" && process.env.AYME_E2E_AVAILABILITY !== "0";
const require = createRequire(import.meta.url);
// e2e resolves relative paths against the config's directory, so the log path
// is made absolute here, relative to the fixture app (where runs start).
const log =
  process.env.AYME_E2E_LOG === undefined
    ? undefined
    : path.resolve(
        fileURLToPath(new URL("..", import.meta.url)),
        process.env.AYME_E2E_LOG
      );

function agentOptions(
  agent: "claude" | "cursor"
): Omit<AcpDriverOptions, "name"> {
  switch (agent) {
    case "claude":
      return {
        command: process.execPath,
        args: [
          require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js"),
        ],
        model: model ?? "sonnet",
        mode: "default",
        // No built-in tool, no user or project settings, no skills, no
        // transcript: the test's tools are the only way to the app.
        meta: {
          claudeCode: {
            options: {
              tools: [],
              settingSources: [],
              skills: [],
              persistSession: false,
              strictMcpConfig: true,
            },
          },
        },
        ...(process.env.AYME_E2E_SYSTEM_PROMPT === "meta"
          ? { systemPrompt: "meta" as const }
          : {}),
      };
    case "cursor":
      return {
        command: process.env.AYME_E2E_CURSOR_AGENT ?? "agent",
        args: ["acp"],
        // Opus 4.6 as Cursor's ACP model picker lists it (not MAX mode).
        model:
          model ?? "claude-opus-4-6[thinking=true,context=200k,effort=high]",
      };
  }
}

export default config(name, {
  executor: aymeExecutor({
    tools: arm === "ayme" ? aymeTools({ engine, files: POM_FILES }) : {},
    ...(log === undefined ? {} : { logFile: `${log}.jsonl` }),
    ...(availability
      ? { availability: aymeAvailability({ engine, files: POM_FILES }) }
      : {}),
    storeDir: dirs(name).ayme,
    solver: agentSolver(
      acpDriver({
        name: `acp-${agent}`,
        ...agentOptions(agent),
        ...(log === undefined ? {} : { stderrFile: `${log}.stderr` }),
      }),
      { offerPageObjects: arm === "ayme" }
    ),
  }),
});
