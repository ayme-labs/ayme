import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The stock trace tool, `playwright trace`, run through the project's own
// Playwright. It is how the engine learns the numbers a reader opens the
// recording's snapshots by: the tool's own numbering, which no archive
// reader can guess.

/** What one run of the tool came to. */
export type ToolRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs `playwright trace <args>` with Playwright's own command line, in a
 * folder of its own: the tool keeps what it has opened per folder. */
export function runTraceTool(
  cli: string,
  args: readonly string[],
  cwd: string
): Promise<ToolRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, "trace", ...args],
      // Opening a large trace takes a while. A tool that hangs is let go.
      { cwd, maxBuffer: 1 << 28, timeout: 120_000 },
      (error, stdout, stderr) =>
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout,
          stderr,
        })
    );
  });
}

/**
 * Where each snapshot marker is, in the trace's own numbering. A marker is a
 * group named for a snapshot's id, with one call inside it, and a reader
 * opens the snapshot by the call's number: the group has no page of its own.
 * Lists a marker only when the call is there.
 */
export function positionsOfSnapshots(
  actions: string
): Readonly<Record<string, string>> {
  // "   4. 0:00.252    Evaluate   3ms": the number, the time, then the
  // action, indented one step further for each group it is inside.
  const row = /^\s*(\d+)\.\s+\S+(\s+)(\S.*?)\s{2,}\S+\s*$/;
  const rows = actions.split("\n").map((line) => row.exec(line));
  const positions: Record<string, string> = {};
  rows.forEach((marker, index) => {
    const id = marker && /^(snapshot_\d+)$/.exec(marker[3]!)?.[1];
    const call = rows[index + 1];
    if (id && call && call[2]!.length > marker[2]!.length)
      positions[id] = call[1]!;
  });
  return positions;
}

/**
 * The trace's snapshot markers and where each is: the tool opens the trace,
 * lists its actions and closes it again. A tool that cannot be run, or a
 * trace it cannot read, gives none: the trace is still there to be read with
 * the tool, only the package cannot say where to look.
 */
export async function snapshotPositions(
  cli: string,
  traceFile: string
): Promise<Readonly<Record<string, string>>> {
  const cwd = await mkdtemp(join(tmpdir(), "ayme-recorder-trace-"));
  try {
    const opened = await runTraceTool(cli, ["open", traceFile], cwd);
    if (opened.code !== 0) return {};
    const actions = await runTraceTool(cli, ["actions"], cwd);
    return actions.code === 0 ? positionsOfSnapshots(actions.stdout) : {};
  } finally {
    await runTraceTool(cli, ["close"], cwd);
    await rm(cwd, { recursive: true, force: true });
  }
}
