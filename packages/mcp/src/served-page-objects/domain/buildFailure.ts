/** An error of a build, as esbuild reports it, its file an absolute path. */
export type BuildError = {
  text: string;
  location: { file: string; line: number; column: number } | null;
};

/**
 * What `ayme mcp` reports when the Page Objects `entry` does not build:
 * that it failed, what the page gets instead (the last good build, if
 * `lastGood`, else nothing), and each error with the file, line and column
 * it is in. It says what went wrong, not what to do next.
 */
export function buildFailure({
  entry,
  errors,
  lastGood,
}: {
  entry: string;
  errors: readonly BuildError[];
  lastGood: boolean;
}): string {
  const served = lastGood
    ? "The page gets the last good build."
    : "No build of it has succeeded, so none is served.";
  return [
    `The Page Objects entry ${entry} did not build. ${served}`,
    ...errors.map(({ text, location }) =>
      location === null
        ? `  ${text}`
        : `  ${location.file}:${location.line}:${location.column}: ${text}`
    ),
  ].join("\n");
}
