/**
 * A child process the harness can end for certain, with whatever it started.
 *
 * Ending the child alone is not enough. A process it started may outlive it,
 * and one that inherited a pipe of the child's keeps that pipe open: the
 * harness's end of it never ends, and Node does not exit while it is open.
 * `ayme mcp` left its esbuild service behind that way when it was killed
 * while a request of the service was unanswered, and a suite that had
 * written its summary then never ended.
 *
 * So the child leads a process group of its own, a signal goes to the whole
 * group, and stopping waits for the child's stdio to end, not only for its
 * exit.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** Signals every process of the group `pid` leads; a group that is gone already is fine. */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** The signals that end the harness from outside. */
const interruptSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export type ProcessGroup = {
  child: ChildProcess;
  /**
   * Ends the group and resolves once the child's stdio has ended. Whether a
   * process that left the group still held that stdio open: the harness
   * then dropped its own end, so the caller can say so.
   */
  stop: () => Promise<{ stdioHeldOpen: boolean }>;
};

/**
 * Starts `command` with piped stdio as the leader of its own process group.
 * `stop` sends the group SIGTERM, and SIGKILL to whatever of it is left once
 * `termGraceMs` have passed or the stdio has ended. A process that left the
 * group and still holds the child's stdio `closeGraceMs` after that is out
 * of reach: the harness destroys its own end of the pipes instead of
 * waiting on them.
 *
 * A group of its own gets neither the terminal's Ctrl+C nor the harness's
 * end by itself, so until it is stopped the group is killed when the
 * harness exits or is interrupted.
 */
export function spawnProcessGroup(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    termGraceMs?: number;
    closeGraceMs?: number;
  }
): ProcessGroup {
  const { termGraceMs = 5_000, closeGraceMs = 2_000 } = options;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  // Registered at once: a child that ends by itself has closed before `stop` is called.
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid !== undefined) signalProcessGroup(child.pid, signal);
  };

  const killGroup = () => signalGroup("SIGKILL");
  const onInterrupt = (signal: NodeJS.Signals) => {
    killGroup();
    // Another listener, such as Playwright's or the agent's, ends the harness; with none, the
    // signal does what it would have done without this one.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  process.once("exit", killGroup);
  for (const signal of interruptSignals) process.once(signal, onInterrupt);

  const stop = async () => {
    process.off("exit", killGroup);
    for (const signal of interruptSignals) process.off(signal, onInterrupt);
    signalGroup("SIGTERM");
    const forceKill = setTimeout(killGroup, termGraceMs);
    let giveUp: NodeJS.Timeout | undefined;
    const ended = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolve) => {
        giveUp = setTimeout(() => resolve(false), termGraceMs + closeGraceMs);
      }),
    ]);
    clearTimeout(forceKill);
    clearTimeout(giveUp);
    // Whatever of the group ignored SIGTERM without holding the stdio.
    killGroup();
    if (ended) return { stdioHeldOpen: false };
    for (const stream of [child.stdin, child.stdout, child.stderr])
      stream?.destroy();
    return { stdioHeldOpen: true };
  };
  return { child, stop };
}
