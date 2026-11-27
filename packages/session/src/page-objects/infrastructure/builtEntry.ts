// The plain rules of building a project's Page Objects for Node: what the
// entry must export, and how a failed build is told. The build itself is in
// nodeBuild.ts.
import { Effect } from "effect";
import type { PartialMessage } from "esbuild";

import { SessionStartError } from "../../session/domain";

/**
 * One reason a module did not compile, as the project's Page Object
 * compiler states it: the file at fault and the 1-based line and column in
 * it as written, with that line's text, where it knows them.
 */
export type PomDiagnostic =
  | { readonly text: string; readonly file?: undefined }
  | { readonly text: string; readonly file: string; readonly line?: undefined }
  | {
      readonly text: string;
      readonly file: string;
      readonly line: number;
      /** Counted in UTF-16 code units of `lineText`. */
      readonly column: number;
      /** The line as written, without its line break. */
      readonly lineText: string;
    };

/**
 * The compiler's diagnostics for the module `compiled` as esbuild's errors,
 * so the build tells them with its own. One without a file is at
 * `compiled`: esbuild would put it at the import of that module.
 */
export function compileErrors(
  diagnostics: readonly PomDiagnostic[],
  compiled: string
): PartialMessage[] {
  return diagnostics.map((diagnostic) => {
    const { text } = diagnostic;
    if (diagnostic.file === undefined)
      return { text, location: { file: compiled } };
    if (diagnostic.line === undefined)
      return { text, location: { file: diagnostic.file } };
    const { file, line, column, lineText } = diagnostic;
    return {
      text,
      location: {
        file,
        line,
        // TypeScript counts the column from 1 in UTF-16 code units; esbuild
        // counts it from 0 in UTF-8 bytes.
        column: Buffer.byteLength(lineText.slice(0, column - 1)),
        // esbuild draws its code frame from this line, which it has not
        // loaded.
        lineText,
      },
    };
  });
}

/** Why the Session did not start: the Page Objects of `entry` did not
 * build, with the build's messages, as esbuild formats them, and the first
 * of its `errors` on one line, where it says where it is. */
export const buildFailed = (
  entry: string,
  messages: readonly string[],
  [first]: readonly PartialMessage[] = []
): SessionStartError =>
  new SessionStartError(
    `The Page Objects of ${entry} did not build:\n${messages
      .map((message) => message.trimEnd())
      .join("\n")}`,
    first?.text === undefined ? undefined : `${placeOf(first)}${first.text}`
  );

/** Where `message` is, as an editor names a place, followed by ": ": its
 * file, line and column, each counted from 1, and as much of them as
 * esbuild knows. esbuild counts a column from 0 in the UTF-8 bytes of the
 * line, so it is known only with the line's text. */
const placeOf = ({ location }: PartialMessage) => {
  if (!location?.file) return "";
  const { file, line, column, lineText } = location;
  const known = line ? [file, line] : [file];
  if (line && column !== undefined && lineText !== undefined)
    known.push(Buffer.from(lineText).subarray(0, column).toString().length + 1);
  return `${known.join(":")}: `;
};

/** The Page Object classes the built `entry` lists as its default
 * export. Two different classes of one name are refused here, since the
 * registry tells classes apart by name and would leave one of them out. */
export const pageObjectClasses = (
  module: { readonly default?: unknown },
  entry: string
): Effect.Effect<readonly unknown[], SessionStartError> => {
  const listed = module.default;
  if (
    !Array.isArray(listed) ||
    !listed.every((item) => typeof item === "function")
  )
    return Effect.fail(
      new SessionStartError(
        `The default export of ${entry} is not an array of Page Object classes. List the project's Page Object classes in it: export default [Basket, Checkout];`
      )
    );
  const byName = new Map<string, unknown>();
  for (const model of listed as readonly { readonly name: string }[]) {
    const named = byName.get(model.name);
    if (named !== undefined && named !== model)
      return Effect.fail(
        new SessionStartError(
          `The default export of ${entry} lists two different classes named ${model.name}. ayme tells Page Object classes apart by name: rename one of them.`
        )
      );
    byName.set(model.name, model);
  }
  return Effect.succeed(listed);
};
