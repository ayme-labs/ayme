/**
 * How a command that starts processes ends. Every run closes what it
 * started, and Node then exits by itself with the command's exit code. If
 * something was left open after all, Node would wait on it for ever, and a
 * hosted job with it: so a command that is still alive a few seconds after
 * its work is done says what Node still holds open and exits with the code
 * it was going to exit with. A command that ends by itself says nothing.
 */

/** How long a finished command may take to end by itself. */
export const exitGraceMs = 5_000;

/**
 * The kinds of resource in `now` beyond those in `atStart`, each as often as
 * it is extra: what a command opened and did not close, by the names
 * `process.getActiveResourcesInfo()` gives them.
 */
export function resourcesLeftOpen(atStart: string[], now: string[]): string[] {
  const own = [...atStart];
  return now.filter((kind) => {
    const index = own.indexOf(kind);
    if (index === -1) return true;
    own.splice(index, 1);
    return false;
  });
}

/** `3 PipeWrap, 1 Timeout` for the kinds in `kinds`. */
export function countedKinds(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${count} ${kind}`).join(", ");
}

/**
 * Runs a command's `main`, which sets `process.exitCode` for a result that
 * is no error; an error it throws is written to standard error and makes the
 * exit code 2. Then the backstop: unless Node has ended by itself within
 * `graceMs`, the command logs what is still open and exits.
 */
export async function runCommand(
  main: () => Promise<void>,
  log: (line: string) => void,
  graceMs: number = exitGraceMs
): Promise<void> {
  // The command's own output streams, opened here so that they count as its own, not as left open.
  process.stdout.write("");
  process.stderr.write("");
  const atStart = process.getActiveResourcesInfo();
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
  // Not a reason to stay alive itself: with nothing left open, Node ends before it fires.
  setTimeout(() => {
    const left = resourcesLeftOpen(atStart, process.getActiveResourcesInfo());
    log(
      `The command did not end by itself within ${graceMs / 1000} s of finishing: something it started was not closed. Node still holds open: ${countedKinds(left) || "nothing it names"}. Exiting with code ${process.exitCode ?? 0}.`
    );
    process.exit();
  }, graceMs).unref();
}
