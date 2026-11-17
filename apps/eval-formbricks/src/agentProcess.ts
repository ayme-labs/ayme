/**
 * The process of an agent, whichever agent it is: spawned in its own process
 * group, its output written to the transcript line by line, each turn timed
 * and stopped at its timeout, and nothing of its group left behind when the
 * run ends. What an agent is sent and what its output means is its driver's.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

import { processGroups, signalGroups } from "./processGroups.ts";

/** One message sent to the agent, and how long it took to answer it. */
export type Turn = {
  /** When the message was sent. */
  sentAt: string;
  /** From the message to the end of its turn; `null` when the turn never ended. */
  wallTimeMs: number | null;
  timedOut: boolean;
};

export type TurnResult = { isError: boolean };

function closeStream(stream: NodeJS.WritableStream & { closed?: boolean }) {
  return new Promise<void>((resolve, reject) => {
    if (stream.closed) return resolve();
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

export type AgentProcess = ReturnType<typeof startAgentProcess>;

export function startAgentProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  transcriptPath: string;
  stderrPath: string;
  /** Called with each line of the agent's output; a line it returns `false` for stays out of the transcript. */
  onLine: (line: string) => boolean;
}) {
  const transcript = createWriteStream(options.transcriptPath);
  const stderr = createWriteStream(options.stderrPath);
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.environment,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(stderr);
  // A message sent to an agent that has already exited must not take the harness down.
  child.stdin.on("error", (error) =>
    stderr.write(`harness: writing to the agent failed: ${error.message}\n`)
  );

  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    if (!options.onLine(line)) return;
    lines.push(line);
    transcript.write(`${line}\n`);
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
  /** Resolves when the agent has ended, however it ended. */
  const ended = closed.then(
    () => undefined,
    () => undefined
  );

  // An agent may start an MCP server in a process group of its own, as Codex does, so the groups
  // to stop are looked up while the agent still runs: once it is gone, they can no longer be found.
  const groups = new Set<number>();
  const findGroups = () => {
    if (child.pid && child.exitCode === null)
      for (const group of processGroups(child.pid)) groups.add(group);
  };
  let forceKill: NodeJS.Timeout | undefined;
  const stop = () => {
    findGroups();
    signalGroups(groups, "SIGTERM");
    forceKill ??= setTimeout(() => signalGroups(groups, "SIGKILL"), 10_000);
  };
  // The child runs in its own process group so a timeout can take the MCP server and browser with it;
  // an interrupted harness must do the same instead of leaving them behind.
  let interruptedBy: NodeJS.Signals | null = null;
  const onInterrupt = (received: NodeJS.Signals) => {
    interruptedBy = received;
    stop();
    process.once("exit", () => process.kill(process.pid, received));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  let onTurnEnd: ((result: TurnResult) => void) | null = null;
  let linger: NodeJS.Timeout | undefined;

  return {
    /** The lines of the agent's output kept in the transcript. */
    lines,
    ended,
    stop,
    exited: () => child.exitCode !== null,
    write: (text: string) => child.stdin.write(text),
    /** The driver calls it when the agent's output says the current turn ended. */
    completeTurn: (result: TurnResult) => onTurnEnd?.(result),
    /**
     * Sends one message with `send` and waits for the turn's end, the turn's
     * timeout, which stops the agent, or the agent's own end.
     */
    turn: async (timeoutMs: number, send: () => void) => {
      const sentAt = Date.now();
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      const result = await new Promise<TurnResult | null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          stop();
          resolve(null);
        }, timeoutMs);
        onTurnEnd = resolve;
        void ended.then(() => resolve(null));
        send();
      });
      clearTimeout(timer);
      onTurnEnd = null;
      const turn: Turn = {
        sentAt: new Date(sentAt).toISOString(),
        wallTimeMs: result === null ? null : Date.now() - sentAt,
        timedOut,
      };
      return { turn, result };
    },
    /**
     * Ends the agent's input and waits for it to exit, stopping one that
     * lingers past `exitGraceMs`. Throws when the run was interrupted: an
     * interrupted run is not a result, so nothing is stored and a suite stops.
     */
    finish: async (exitGraceMs: number) => {
      findGroups();
      child.stdin.end();
      linger = setTimeout(stop, exitGraceMs);
      const exit = await closed;
      await readerClosed;
      await Promise.all([closeStream(transcript), closeStream(stderr)]);
      if (interruptedBy)
        throw new Error(`The run was interrupted by ${interruptedBy}.`);
      return exit;
    },
    /** Always called when the run ends, however it ends. */
    dispose: () => {
      if (linger) clearTimeout(linger);
      if (forceKill) clearTimeout(forceKill);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      // The agent is gone, or the run failed: whatever is left of its process group,
      // an MCP server or a browser that ignored the first signal, goes with it.
      findGroups();
      signalGroups(groups, "SIGKILL");
    },
  };
}

/** Why the setup turn did not complete, or `null` when the task can be sent. */
export function setupTurnFailure(
  agent: AgentProcess,
  setup: { turn: Turn; result: TurnResult | null },
  setupTimeoutMs: number
): string | null {
  return setup.turn.timedOut
    ? `the setup turn ran out of its ${setupTimeoutMs / 1000} s timeout`
    : setup.result === null
      ? "the agent ended before answering the setup message"
      : setup.result.isError
        ? "the setup turn ended with an error"
        : agent.exited()
          ? "the agent ended right after the setup turn"
          : null;
}
