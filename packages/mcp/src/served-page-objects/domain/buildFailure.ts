/** An error of a build, as esbuild reports it, its file an absolute path. */
export type BuildError = {
  text: string;
  location: {
    file: string;
    line: number;
    /** Counted from 0 in UTF-8 bytes, as esbuild counts it. */
    column: number;
    /** The text of `line`, where esbuild has it. */
    lineText?: string;
  } | null;
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
 * column, if it has them, and its text. esbuild counts lines from 1 and
 * columns from 0 in UTF-8 bytes; the line counts both from 1, and the column
 * in UTF-16 code units of the error's line text, as editors and TypeScript
 * do. Without that text, esbuild's count stands in.
 */
export function buildErrorLine({ text, location }: BuildError): string {
  if (location === null) return text;
  if (location.line === 0) return `${location.file}: ${text}`;
  return `${location.file}:${location.line}:${editorColumn(location)}: ${text}`;
}

/** esbuild's `column` of `lineText`, counted from 1 in UTF-16 code units. */
function editorColumn({
  column,
  lineText,
}: {
  column: number;
  lineText?: string;
}): number {
  // esbuild gives an empty line text for a line it did not read; on a line
  // that is empty, the column is 0 either way.
  if (!lineText) return column + 1;
  const bytes = new TextEncoder().encode(lineText).subarray(0, column);
  // Decoded as it is: by default a decoder drops a U+FEFF that comes first.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).length + 1;
}
