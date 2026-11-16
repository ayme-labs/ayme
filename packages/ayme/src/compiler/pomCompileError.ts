import ts from "typescript";

/**
 * One reason a module did not compile: its text and, where the compiler knows
 * them, the file at fault and the 1-based line and column in that file as
 * written. A position in code the compiler generated is left out.
 */
export type PomDiagnostic =
  | { readonly text: string; readonly file?: undefined }
  | { readonly text: string; readonly file: string; readonly line?: undefined }
  | {
      readonly text: string;
      readonly file: string;
      readonly line: number;
      readonly column: number;
    };

/**
 * A module did not compile because of what its source, an import or its
 * tsconfig says. Anything else the compiler throws is a fault of its own.
 * Its message is one line per diagnostic, for a caller that only shows it.
 */
export class PomCompileError extends Error {
  override readonly name = "PomCompileError";
  readonly diagnostics: readonly PomDiagnostic[];

  constructor(diagnostics: readonly PomDiagnostic[], options?: ErrorOptions) {
    super(diagnostics.map(diagnosticLine).join("\n"), options);
    this.diagnostics = diagnostics;
  }
}

/** A `PomCompileError` with one diagnostic, at `node`'s name if it has one. */
export function pomCompileErrorAt(node: ts.Node, text: string) {
  return new PomCompileError([diagnosticAt(node, text)]);
}

/** A diagnostic at `node`'s name, if it has one, or at `node`. */
export function diagnosticAt(node: ts.Node, text: string): PomDiagnostic {
  const named = (node as { name?: ts.Node }).name ?? node;
  const source = named.getSourceFile();
  return position(text, source, named.getStart(source));
}

/** TypeScript's `diagnostic`, at its file and start if it has them. */
export function typeScriptDiagnostic(diagnostic: ts.Diagnostic): PomDiagnostic {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const { file, start } = diagnostic;
  if (file === undefined) return { text };
  if (start === undefined) return { text, file: file.fileName };
  return position(text, file, start);
}

function position(
  text: string,
  source: ts.SourceFile,
  start: number
): PomDiagnostic {
  // TypeScript counts the line and the column from 0.
  const { line, character } = source.getLineAndCharacterOfPosition(start);
  return { text, file: source.fileName, line: line + 1, column: character + 1 };
}

function diagnosticLine(diagnostic: PomDiagnostic): string {
  if (diagnostic.file === undefined) return diagnostic.text;
  if (diagnostic.line === undefined)
    return `${diagnostic.file}: ${diagnostic.text}`;
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.text}`;
}
