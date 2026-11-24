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
  /**
   * Scrubs what is kept of the agent's output, never what `onLine` reads: each
   * transcript line, and stderr as a whole once it is complete, since free text
   * such as JSON printed over several lines holds a secret on no single line.
   * Without it, stderr is written as it arrives.
   */
  redact?: (text: string) => string;
}) {
  const { redact } = options;
  // Before the logs: an agent that cannot be spawned at all throws here, with nothing opened yet.
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.environment,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const transcript = createWriteStream(options.transcriptPath);
  const stderr = createWriteStream(options.stderrPath);
  // A log that cannot be written, a full disk for one, fails the run, not the harness:
  // the agent is stopped and `finish` reports it, so a suite records the failure and cleans up.
  let logFailure: Error | null = null;
  for (const log of [transcript, stderr])
    log.on("error", (error) => {
      logFailure ??= error;
      stop();
    });
  // Watched from the start: a log that fails emits its error and then closes, at any time,
  // and only its close says that every error it had has been reported.
  const logsClosed = Promise.all(
    [transcript, stderr].map(
      (log) => new Promise<void>((resolve) => log.once("close", resolve))
    )
  );
  // Held until the agent has ended when it is to be scrubbed, so it is scrubbed as a whole.
  let heldStderr = "";
  if (redact === undefined) child.stderr.pipe(stderr);
  else {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (heldStderr += chunk));
  }
  // A message sent to an agent that has already exited must not take the harness down.
  child.stdin.on("error", (error) => {
    const message = `harness: writing to the agent failed: ${error.message}\n`;
    if (redact === undefined) stderr.write(message);
    else heldStderr += message;
  });

  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    if (!options.onLine(line)) return;
    const kept = redact?.(line) ?? line;
    lines.push(kept);
    transcript.write(`${kept}\n`);
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

  let leftoversKilled = false;
  /**
   * The agent is gone, or the run failed: whatever is left of its process
   * groups, an MCP server or a browser that ignored the first signal, goes
   * with it. Once only, and as soon as the agent has exited, so a group's
   * id cannot have passed to another process in between.
   */
  const killLeftovers = () => {
    if (leftoversKilled) return;
    leftoversKilled = true;
    findGroups();
    signalGroups(groups, "SIGKILL");
  };

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
     * Throws too when the transcript or the agent's stderr could not be
     * written: a run without them is not a result either.
     */
    finish: async (exitGraceMs: number) => {
      findGroups();
      child.stdin.end();
      linger = setTimeout(stop, exitGraceMs);
      const exit = await closed;
      killLeftovers();
      await readerClosed;
      // The agent's stderr has closed with the agent, so what is held is all of it.
      if (redact !== undefined && !stderr.destroyed)
        stderr.write(redact(heldStderr));
      for (const log of [transcript, stderr]) if (!log.destroyed) log.end();
      await logsClosed;
      if (interruptedBy)
        throw new Error(`The run was interrupted by ${interruptedBy}.`);
      if (logFailure !== null)
        throw new Error(
          `Writing the run's transcript or the agent's stderr failed: ${(logFailure as Error).message}`
        );
      return exit;
    },
    /** Always called when the run ends, however it ends. */
    dispose: () => {
      if (linger) clearTimeout(linger);
      if (forceKill) clearTimeout(forceKill);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      killLeftovers();
      // A run that failed before `finish` closed them, an agent that could not be spawned for one.
      transcript.destroy();
      stderr.destroy();
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
