/**
 * Runs Claude Code in headless print mode with stream-json output and the
 * isolated configuration every arm shares. The caller supplies only what the
 * arm contributes.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

import type { Arm } from "./arms.ts";

export type ClaudeInvocation = {
  /** The agent's working root. */
  cwd: string;
  /** The isolated Claude Code configuration directory. */
  configDir: string;
  model: string;
  arm: Arm;
  /** The MCP servers file, written by the caller from `arm.mcpServers`. */
  mcpConfigPath: string;
  prompt: string;
  timeoutMs: number;
  transcriptPath: string;
  stderrPath: string;
};

export type ClaudeRun = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** Wall clock from the first stream-json event to the last; `null` when none arrived. */
  wallTimeMs: number | null;
  startedAt: string;
  finishedAt: string;
  lines: string[];
};

/**
 * The shared configuration: no settings from the user or the project, no MCP
 * servers beyond the arm's own, only the arm's built-in tools, and every
 * permission question answered by denial. The arm's interface is allowed
 * without a prompt, so the agent is never asked anything.
 */
export function claudeArguments(invocation: {
  model: string;
  arm: Arm;
  mcpConfigPath: string;
}) {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    invocation.model,
    "--setting-sources",
    "",
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
    "--allowedTools",
    invocation.arm.allowedTools.join(","),
  ];
}

export function claudeEnvironment(configDir: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_CONFIG_DIR: configDir };
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

export function claudeAuthStatus(configDir: string): ClaudeAuthStatus | null {
  const result = spawnSync("claude", ["auth", "status"], {
    encoding: "utf8",
    env: claudeEnvironment(configDir),
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

/** Spawns Claude Code, streams its events to the transcript and kills the whole process group on timeout. */
export async function runClaude(
  invocation: ClaudeInvocation
): Promise<ClaudeRun> {
  const transcript = createWriteStream(invocation.transcriptPath);
  const stderr = createWriteStream(invocation.stderrPath);
  const startedAt = new Date();
  const child = spawn("claude", claudeArguments(invocation), {
    cwd: invocation.cwd,
    env: claudeEnvironment(invocation.configDir),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(stderr);
  child.stdin.end(invocation.prompt);

  const lines: string[] = [];
  let firstEventAt: number | null = null;
  let lastEventAt: number | null = null;
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    const now = Date.now();
    firstEventAt ??= now;
    lastEventAt = now;
    lines.push(line);
    transcript.write(`${line}\n`);
  });
  // Registered before the child can close: readline closes with stdout, ahead of the child's own close.
  const readerClosed = new Promise<void>((resolve) =>
    reader.once("close", resolve)
  );

  let timedOut = false;
  let forceKill: NodeJS.Timeout | undefined;
  const stopChild = () => {
    if (!child.pid) return;
    signalProcessGroup(child.pid, "SIGTERM");
    forceKill ??= setTimeout(() => {
      if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
    }, 10_000);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    stopChild();
  }, invocation.timeoutMs);
  // The child runs in its own process group so the timeout can take the MCP server and browser with it;
  // an interrupted harness must do the same instead of leaving them behind.
  const onInterrupt = (received: NodeJS.Signals) => {
    stopChild();
    process.once("exit", () => process.kill(process.pid, received));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  try {
    const { exitCode, signal } = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, closeSignal) =>
        resolve({ exitCode: code, signal: closeSignal })
      );
    });
    await readerClosed;
    await Promise.all([closeStream(transcript), closeStream(stderr)]);
    return {
      exitCode,
      signal,
      timedOut,
      wallTimeMs:
        firstEventAt === null || lastEventAt === null
          ? null
          : lastEventAt - firstEventAt,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      lines,
    };
  } finally {
    clearTimeout(timeout);
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
