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
