/**
 * Runs Claude Code in headless print mode with stream-json input and output
 * and the isolated configuration every arm shares. The caller supplies only
 * what the arm contributes.
 *
 * The agent gets two user messages over stdin, each its own turn: a setup
 * message, so that starting up and loading the arm's skill happen before the
 * task, and then the task. The task turn is the measured one; its timing is
 * taken from sending its message to its `result` event. The setup turn has
 * its own, shorter timeout, and the task is sent only after it completed. A
 * run without a task ends after the setup turn.
 */
import { spawnSync } from "node:child_process";

import {
  setupTurnFailure,
  startAgentProcess,
  type Turn,
} from "./agentProcess.ts";
import type { Arm } from "./arms.ts";
import { resultEvent } from "./transcript.ts";

/** How long the setup turn may take; a setup that runs out of it ends the run. */
export const setupTimeoutMs = 120_000;

/** How long Claude Code may take to exit once its input is closed before it is stopped. */
const exitGraceMs = 30_000;

/** The arm's part of the agent's configuration: its built-in tools and permission rules. */
type AgentTools = Pick<Arm, "tools" | "allowedTools" | "disallowedTools">;

export type ClaudeInvocation = {
  /** The agent's working root. */
  cwd: string;
  /** The agent's environment, from `claudeEnvironment`. */
  environment: NodeJS.ProcessEnv;
  model: string;
  arm: AgentTools;
  /** The MCP servers file, written by the caller from `arm.mcpServers`. */
  mcpConfigPath: string;
  /** Folders outside the working root the agent may read, from the arm's setup. */
  readableDirectories?: string[];
  /** The first message: get ready, without touching the page. */
  setupPrompt: string;
  /** The setup turn's timeout; `setupTimeoutMs` by default. */
  setupTimeoutMs?: number;
  transcriptPath: string;
  stderrPath: string;
  /** Every token value to scrub from the agent's output before it is kept: the one in `environment` and any other login's. */
  secrets?: string[];
} & (
  | {
      /** The second message: the task. */
      prompt: string;
      /** The task turn's timeout. */
      timeoutMs: number;
    }
  | { prompt?: undefined; timeoutMs?: undefined }
);

export type ClaudeRun = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  setup: Turn;
  /** Why the setup turn did not complete; the task is sent only after a completed setup turn. */
  setupFailure: string | null;
  /** A turn's `result` event said the Claude Code login hit its usage limit; Codex's driver does not report its limits. */
  usageLimited?: boolean;
  /** The measured turn; `null` when the task was never sent. */
  task: Turn | null;
  /** When the agent was started. */
  startedAt: string;
  /** When the agent's process ended. */
  finishedAt: string;
  lines: string[];
};

/**
 * The shared configuration: no settings from the project, and none from the
 * user beyond the run's own fresh, empty configuration folder (which is where
 * an arm's skill lives); no MCP servers beyond the arm's own, only the arm's
 * built-in tools, and every permission question answered by denial. The arm's
 * interface is allowed without a prompt, so the agent is never asked anything.
 */
/**
 * The agent's thinking effort, the same for every arm. Claude Code's default let the model pause
 * for minutes before a single step of a five-step task, which made wall time measure think time
 * rather than the browser interface. `medium` keeps step-by-step reasoning without those pauses.
 */
export const agentEffort = "medium";

export function claudeArguments(invocation: {
  model: string;
  arm: AgentTools;
  mcpConfigPath: string;
  readableDirectories?: string[];
}) {
  const readableDirectories = invocation.readableDirectories ?? [];
  const disallowedTools = invocation.arm.disallowedTools ?? [];
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    invocation.model,
    "--effort",
    agentEffort,
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--mcp-config",
    invocation.mcpConfigPath,
    "--tools",
    invocation.arm.tools.join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    ...(readableDirectories.length === 0
      ? []
      : ["--add-dir", ...readableDirectories]),
    "--allowedTools",
    invocation.arm.allowedTools.join(","),
    ...(disallowedTools.length === 0
      ? []
      : ["--disallowedTools", disallowedTools.join(",")]),
  ];
}

/**
 * The environment without any Claude Code, Anthropic or ayme variable of
 * whoever launched the eval. The ayme variables hold the lab app's model key,
 * which the agent must never see.
 */
export function withoutClaudeVariables(
  parent: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (!/^(CLAUDE|ANTHROPIC|AYME_)/.test(key)) environment[key] = value;
  }
  return environment;
}

/**
 * The environment the agent runs in: the parent's, minus every Claude Code,
 * Anthropic and ayme variable the launcher may carry (its own settings, base
 * URL, session ids, the lab app's model key), plus a fresh configuration
 * directory and the eval's own token. Nothing else. The token is never written
 * anywhere; it lives only in this environment.
 */
export function claudeEnvironment(
  options: { configDir: string; oauthToken: string },
  parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment = withoutClaudeVariables(parent);
  environment.CLAUDE_CONFIG_DIR = options.configDir;
  environment.CLAUDE_CODE_OAUTH_TOKEN = options.oauthToken;
  return environment;
}

/**
 * One character of a secret as it may be printed: itself, or its JSON escape
 * (`\u0073`, in either case of hex digit), the only escape JSON has for the
 * letters, digits and dashes of a token.
 */
function printedCharacter(character: string) {
  const hex = character
    .charCodeAt(0)
    .toString(16)
    .padStart(4, "0")
    .replace(/[a-f]/g, (digit) => `[${digit}${digit.toUpperCase()}]`);
  return `(?:${character.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")}|\\\\u${hex})`;
}

/**
 * Builds the function that replaces every secret in a text, whether it is written out
 * or spelled with JSON escapes (`\u0073k-ant-...`), in a string, a key or
 * anywhere else in the text, so it holds for a stream-json line as for the
 * whole of stderr, indented JSON over several lines included. What is not a
 * secret stays byte for byte. The patterns are built once, here, not per line.
 * The longest secret is replaced first, so one that begins with another is
 * replaced whole and leaves no tail behind.
 */
export function secretRedactor(secrets: string[]): (text: string) => string {
  const patterns = secrets
    .filter((secret) => secret !== "")
    .sort((one, other) => other.length - one.length)
    .map(
      (secret) =>
        new RegExp(secret.split("").map(printedCharacter).join(""), "g")
    );
  return (text) =>
    patterns.reduce(
      (redacted, pattern) => redacted.replace(pattern, "[redacted]"),
      text
    );
}

export function claudeVersion(): string | null {
  const result = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    env: withoutClaudeVariables(process.env),
  });
  if (result.status !== 0) return null;
  return result.stdout.trim().replace(/\s*\(Claude Code\)\s*$/, "") || null;
}

export type ClaudeAuthStatus = {
  loggedIn: boolean;
  authMethod: string | null;
  configDirectory: string | null;
};

/** Asks Claude Code whether the environment authenticates; the answer carries no secret. */
export function claudeAuthStatus(
  environment: NodeJS.ProcessEnv
): ClaudeAuthStatus | null {
  const result = spawnSync("claude", ["auth", "status"], {
    encoding: "utf8",
    env: environment,
  });
  if (result.error) return null;
  try {
    const status: unknown = JSON.parse(result.stdout);
    if (typeof status !== "object" || status === null) return null;
    const record = status as Record<string, unknown>;
    return {
      loggedIn: record.loggedIn === true,
      authMethod:
        typeof record.authMethod === "string" ? record.authMethod : null,
      configDirectory:
        typeof record.configDirectory === "string"
          ? record.configDirectory
          : null,
    };
  } catch {
    return null;
  }
}

/** A user message as one line of Claude Code's stream-json input. */
export function userMessageLine(text: string) {
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })}\n`;
}

/**
 * Spawns Claude Code, sends the setup message and then the task, streams the
 * events to the transcript, and kills the whole process group when a turn
 * runs out of its timeout.
 */
export async function runClaude(
  invocation: ClaudeInvocation
): Promise<ClaudeRun> {
  const startedAt = new Date();
  let usageLimited = false;
  const agent = startAgentProcess({
    command: "claude",
    args: claudeArguments(invocation),
    cwd: invocation.cwd,
    environment: invocation.environment,
    transcriptPath: invocation.transcriptPath,
    stderrPath: invocation.stderrPath,
    // Neither the transcript nor stderr keeps a token: the output is public once the results folder is uploaded.
    redact: secretRedactor(invocation.secrets ?? []),
    // The event is read as the agent wrote it; only what is kept is scrubbed.
    onLine: (line) => {
      const result = resultEvent(line);
      if (result !== null) {
        usageLimited ||= result.usageLimit;
        agent.completeTurn(result);
      }
      return true;
    },
  });
  /** Sends one message and waits for its result event, the turn's timeout or the agent's end. */
  const turn = (text: string, timeoutMs: number) =>
    agent.turn(timeoutMs, () => agent.write(userMessageLine(text)));

  try {
    const setupTimeout = invocation.setupTimeoutMs ?? setupTimeoutMs;
    const setup = await turn(invocation.setupPrompt, setupTimeout);
    const setupFailure = setupTurnFailure(agent, setup, setupTimeout);
    const task =
      setupFailure === null && invocation.prompt !== undefined
        ? (await turn(invocation.prompt, invocation.timeoutMs)).turn
        : null;
    // Claude Code exits once its input ends; one that lingers is stopped so the run can end.
    const { exitCode, signal } = await agent.finish(exitGraceMs);
    return {
      exitCode,
      signal,
      setup: setup.turn,
      setupFailure,
      usageLimited,
      task,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      lines: agent.lines,
    };
  } finally {
    agent.dispose();
  }
}
