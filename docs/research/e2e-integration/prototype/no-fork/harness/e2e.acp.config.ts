import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  acpDriver,
  agentSolver,
  aymeAvailability,
  aymeExecutor,
  aymeTools,
  type AcpDriverOptions,
} from "../src/index.ts";
import {
  config,
  COUNTER_POM_FILE,
  dirs,
  engine,
  POM_FILE,
} from "./base.config.ts";

/**
 * An ACP agent, one session per test: `SPIKE_ACP_AGENT=claude|cursor|codex`, `SPIKE_ARM=stock|ayme`.
 * `SPIKE_ACP_MODEL` overrides the agent's model (Codex has no default: pick one of its two Lunas).
 */
const agent = process.env.SPIKE_ACP_AGENT;
if (agent !== "claude" && agent !== "cursor" && agent !== "codex")
  throw new Error("set SPIKE_ACP_AGENT=claude|cursor|codex");
const arm = process.env.SPIKE_ARM === "ayme" ? "ayme" : "stock";
const name = process.env.SPIKE_CONFIG_NAME ?? `acp-${agent}-${arm}`;
const multi = process.env.SPIKE_TESTS?.includes("multi") === true;
const pomFiles = multi ? [POM_FILE, COUNTER_POM_FILE] : [POM_FILE];
const model = process.env.SPIKE_ACP_MODEL;
const require = createRequire(import.meta.url);

/** The OAuth token from the env file, only that line, read when a session starts. */
function oauthToken(file: string): string {
  const prefix = "CLAUDE_CODE_OAUTH_TOKEN=";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(prefix));
  const token = line
    ?.slice(prefix.length)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (token === undefined || token === "")
    throw new Error(`no CLAUDE_CODE_OAUTH_TOKEN in ${file}`);
  return token;
}

/**
 * The user-level Codex tools these sessions switch off. Codex loads the
 * user's own MCP servers and plugins into every session, and in the
 * experiment it reached for a browser plugin instead of the test's tools.
 * Name them per machine: `SPIKE_CODEX_MCP_SERVERS` and `SPIKE_CODEX_PLUGINS`,
 * comma-separated, as the user's `~/.codex/config.toml` declares them.
 */
const listFromEnv = (name: string): string[] =>
  (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
const CODEX_ISOLATION = {
  web_search: "disabled",
  tools: { web_search: false },
  features: { multi_agent: false },
  mcp_servers: Object.fromEntries(
    listFromEnv("SPIKE_CODEX_MCP_SERVERS").map((name) => [
      name,
      { enabled: false },
    ])
  ),
  plugins: Object.fromEntries(
    listFromEnv("SPIKE_CODEX_PLUGINS").map((id) => [id, { enabled: false }])
  ),
};

function agentOptions(
  agent: "claude" | "cursor" | "codex"
): Omit<AcpDriverOptions, "name"> {
  switch (agent) {
    case "claude": {
      const tokenFile = process.env.SPIKE_CLAUDE_TOKEN_FILE;
      if (tokenFile === undefined)
        throw new Error("set SPIKE_CLAUDE_TOKEN_FILE");
      return {
        command: process.execPath,
        args: [
          require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js"),
        ],
        env: () => ({ CLAUDE_CODE_OAUTH_TOKEN: oauthToken(tokenFile) }),
        model: model ?? "sonnet",
        mode: "default",
        // Claude adapter options, as claude-code-driver.ts sets them: no built-in tool, no user or project settings, no skills, no transcript.
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
        ...(process.env.SPIKE_ACP_SYSTEM_PROMPT === "meta"
          ? { systemPrompt: "meta" as const }
          : {}),
      };
    }
    case "cursor":
      return {
        command: process.env.SPIKE_CURSOR_AGENT ?? "agent",
        args: ["acp"],
        // Opus 4.6 as Cursor's ACP model picker lists it (not MAX mode).
        model:
          model ?? "claude-opus-4-6[thinking=true,context=200k,effort=high]",
      };
    case "codex":
      if (model === undefined)
        throw new Error("set SPIKE_ACP_MODEL=gpt-6-luna or gpt-5.6-luna");
      return {
        command: process.execPath,
        args: [require.resolve("@agentclientprotocol/codex-acp/dist/index.js")],
        model,
        mode: "read-only",
        // Codex reports input without its cached part (cacheRead exceeded input in the first run).
        inputIncludesCache: false,
        // For these sessions only (merged into the session config, ~/.codex untouched): none of the user's own
        // MCP servers, plugins, web search, or subagents; the test's tools are the only way to the app.
        env: () => ({ CODEX_CONFIG: JSON.stringify(CODEX_ISOLATION) }),
      };
  }
}

export default config(name, {
  executor: aymeExecutor({
    tools: arm === "ayme" ? aymeTools({ engine, files: pomFiles }) : {},
    ...(arm === "ayme" && process.env.SPIKE_AVAILABILITY === "1"
      ? { availability: aymeAvailability({ engine, files: pomFiles }) }
      : {}),
    storeDir: dirs(name).ayme,
    solver: agentSolver(
      acpDriver({
        name: `acp-${agent}`,
        ...agentOptions(agent),
        ...(process.env.SPIKE_LOG === undefined
          ? {}
          : { stderrFile: `${process.env.SPIKE_LOG}.stderr` }),
      }),
      { offerPageObjects: arm === "ayme" }
    ),
  }),
});
