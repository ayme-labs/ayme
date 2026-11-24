/**
 * `--flag value` pairs and bare `--switch` flags after an optional leading
 * `--`, as the package scripts pass them. Anything else throws `usage`.
 */
export function parseFlags(
  argv: string[],
  usage: string,
  switches: string[] = []
) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) throw new Error(usage);
    const name = key.slice(2);
    if (switches.includes(name)) {
      values.set(name, "true");
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error(usage);
    values.set(name, value);
    index += 1;
  }
  return values;
}

/** How long the harness may stay alive once it has reported its outcome. */
const exitGraceMs = 10_000;

/**
 * Runs a command's `main`: an error it throws is printed and ends the
 * harness with exit code 2. Once the outcome is reported the harness ends
 * within `graceMs`, even when something that never closes would keep it
 * alive, a connection to a lab stack that went away for one; without it a
 * job on a runner would wait out its own timeout.
 */
export function runMain(main: () => Promise<void>, graceMs = exitGraceMs) {
  void main()
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 2;
    })
    .finally(() => {
      setTimeout(() => process.exit(), graceMs).unref();
    });
}
