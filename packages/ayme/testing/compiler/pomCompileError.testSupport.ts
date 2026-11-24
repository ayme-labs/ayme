import fs from "node:fs";

import { expect } from "vitest";

import {
  PomCompileError,
  type PomDiagnostic,
} from "../../src/compiler/pomCompileError";

/** The diagnostics of the `PomCompileError` that `compile` throws. */
export function diagnosticsOf(
  compile: () => unknown
): readonly PomDiagnostic[] {
  try {
    compile();
  } catch (error) {
    expect(error).toBeInstanceOf(PomCompileError);
    return (error as PomCompileError).diagnostics;
  }
  throw new Error("The compile did not fail.");
}

/**
 * Where `text` first starts in `fileName`, as the file stands, with the line
 * and the column counted from 1, and that line's text: a header a tool adds
 * to the file, such as Stryker's `// @ts-nocheck`, moves it too.
 */
export function positionOf(fileName: string, text: string) {
  const lines = fs
    .readFileSync(fileName, "utf8")
    .split(/\r\n|[\n\r\u2028\u2029]/);
  const line = lines.findIndex((candidate) => candidate.includes(text));
  if (line === -1) throw new Error(`${fileName} does not hold ${text}.`);
  const lineText = lines[line]!;
  return { line: line + 1, column: lineText.indexOf(text) + 1, lineText };
}
