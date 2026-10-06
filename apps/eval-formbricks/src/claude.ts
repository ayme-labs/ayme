/**
 * Runs Claude Code in headless print mode with stream-json input and output
 * and the isolated configuration every arm shares. The caller supplies only
 * what the arm contributes.
 *
 * The agent gets two user messages over stdin, each its own turn: a setup
 * message, so that starting up and loading the arm's skill happen before the
 * task, and then the task. The task turn is the measured one; its timing is
 * taken from sending its message to its `result` event. The setup turn has
 * its own, shorter timeout, and the task is sent only after it completed.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

import type { Arm } from "./arms.ts";
import { resultEvent } from "./transcript.ts";

/** How long the setup turn may take; a setup that runs out of it ends the run. */
export const setupTimeoutMs = 120_000;

/** How long Claude Code may take to exit once its input is closed before it is stopped. */
const exitGraceMs = 30_000;

export type ClaudeInvocation = {
  /** The agent's working root. */
  cwd: string;
  /** The agent's environment, from `claudeEnvironment`. */
  environment: NodeJS.ProcessEnv;
  model: string;
  arm: Arm;
  /** The MCP servers file, written by the caller from `arm.mcpServers`. */
  mcpConfigPath: string;
  /** Folders outside the working root the agent may read, from the arm's setup. */
  readableDirectories?: string[];
  /** The first message: get ready, without touching the page. */
  setupPrompt: string;
  /** The second message: the task. */
  prompt: string;
  /** The task turn's timeout. */
  timeoutMs: number;
  /** The setup turn's timeout; `setupTimeoutMs` by default. */
  setupTimeoutMs?: number;
  transcriptPath: string;
  stderrPath: string;
};

/** One user message and the agent's answer to it. */
export type Turn = {
  /** When the message was sent. */
  sentAt: string;
  /** Wall clock from sending the message to its `result` event; `null` when none arrived. */
  wallTimeMs: number | null;
  /** The turn ran out of its timeout and the agent was stopped. */
  timedOut: boolean;
};

export type ClaudeRun = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  setup: Turn;
  /** Why the setup turn did not complete; the task is sent only after a completed setup turn. */
  setupFailure: string | null;
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
export function claudeArguments(invocation: {
  model: string;
  arm: Arm;
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
 * The environment without any Claude Code, Anthropic or Ayme variable of
 * whoever launched the eval. The Ayme variables hold the lab app's model key,
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
 * Anthropic and Ayme variable the launcher may carry (its own settings, base
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

export function claudeVersion(): string | null {
  const result = spawnSync("claude", ["--version"], { encoding: "utf8" });
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

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
  const transcript = createWriteStream(invocation.transcriptPath);
  const stderr = createWriteStream(invocation.stderrPath);
  const startedAt = new Date();
  const child = spawn("claude", claudeArguments(invocation), {
    cwd: invocation.cwd,
    env: invocation.environment,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(stderr);
  // A message sent to an agent that has already exited must not take the harness down.
  child.stdin.on("error", (error) =>
    stderr.write(`harness: writing to the agent failed: ${error.message}\n`)
  );

  const lines: string[] = [];
  let onResult: ((event: { isError: boolean }) => void) | null = null;
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    lines.push(line);
    transcript.write(`${line}\n`);
    const result = resultEvent(line);
    if (result !== null) onResult?.(result);
  });
  // Registered before the child can close: readline closes with stdout, ahead of the child's own close.
  const readerClosed = new Promise<void>((resolve) =>
    reader.once("close", resolve)
  );
  const closed = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, closeSignal) =>
      resolve({ exitCode: code, signal: closeSignal })
    );
  });
  const ended = closed.then(
    () => undefined,
    () => undefined
  );

  let forceKill: NodeJS.Timeout | undefined;
  const stopChild = () => {
    if (!child.pid) return;
    signalProcessGroup(child.pid, "SIGTERM");
    forceKill ??= setTimeout(() => {
      if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
    }, 10_000);
  };
  // The child runs in its own process group so a timeout can take the MCP server and browser with it;
  // an interrupted harness must do the same instead of leaving them behind.
  let interruptedBy: NodeJS.Signals | null = null;
  const onInterrupt = (received: NodeJS.Signals) => {
    interruptedBy = received;
    stopChild();
    process.once("exit", () => process.kill(process.pid, received));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  /** Sends one message and waits for its result event, the turn's timeout or the agent's end. */
  const turn = async (text: string, timeoutMs: number) => {
    const sentAt = Date.now();
    child.stdin.write(userMessageLine(text));
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const result = await new Promise<{ isError: boolean } | null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        stopChild();
        resolve(null);
      }, timeoutMs);
      onResult = resolve;
      void ended.then(() => resolve(null));
    });
    clearTimeout(timer);
    onResult = null;
    const timing: Turn = {
      sentAt: new Date(sentAt).toISOString(),
      wallTimeMs: result === null ? null : Date.now() - sentAt,
      timedOut,
    };
    return { turn: timing, result };
  };

  let linger: NodeJS.Timeout | undefined;
  try {
    const setupTimeout = invocation.setupTimeoutMs ?? setupTimeoutMs;
    const { turn: setup, result: setupResult } = await turn(
      invocation.setupPrompt,
      setupTimeout
    );
    const setupFailure = setup.timedOut
      ? `the setup turn ran out of its ${setupTimeout / 1000} s timeout`
      : setupResult === null
        ? "the agent ended before answering the setup message"
        : setupResult.isError
          ? "the setup turn ended with an error"
          : child.exitCode !== null
            ? "the agent ended right after the setup turn"
            : null;
    const task =
      setupFailure === null
        ? (await turn(invocation.prompt, invocation.timeoutMs)).turn
        : null;
    child.stdin.end();
    // Claude Code exits once its input ends; one that lingers is stopped so the run can end.
    linger = setTimeout(stopChild, exitGraceMs);
    const { exitCode, signal } = await closed;
    await readerClosed;
    await Promise.all([closeStream(transcript), closeStream(stderr)]);
    // An interrupted run is not a result: nothing is stored and a suite stops.
    if (interruptedBy)
      throw new Error(`The run was interrupted by ${interruptedBy}.`);
    return {
      exitCode,
      signal,
      setup,
      setupFailure,
      task,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      lines,
    };
  } finally {
    if (linger) clearTimeout(linger);
    if (forceKill) clearTimeout(forceKill);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

function closeStream(stream: NodeJS.WritableStream & { closed?: boolean }) {
  return new Promise<void>((resolve, reject) => {
    if (stream.closed) return resolve();
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}
