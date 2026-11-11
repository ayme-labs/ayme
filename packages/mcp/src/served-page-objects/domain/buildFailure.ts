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
    ...errors.map((error) => `  ${buildErrorLine(error)}`),
  ].join("\n");
}

/**
 * A build error on one line: its file, if it has one, with the line and
 * column, if it has them (esbuild counts lines from 1), and its text.
 */
export function buildErrorLine({ text, location }: BuildError): string {
  if (location === null) return text;
  if (location.line === 0) return `${location.file}: ${text}`;
  return `${location.file}:${location.line}:${location.column}: ${text}`;
}

/**
 * Why a build of the Page Objects `entry` failed: its message is
 * `buildFailure`'s, and it keeps the errors, in esbuild's order.
 */
export class PageObjectsBuildError extends Error {
  readonly entry: string;
  readonly errors: readonly BuildError[];

  constructor(options: {
    entry: string;
    errors: readonly BuildError[];
    lastGood: boolean;
  }) {
    super(buildFailure(options));
    this.entry = options.entry;
    this.errors = options.errors;
  }
}
