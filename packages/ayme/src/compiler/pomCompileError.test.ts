import ts from "typescript";
import { describe, expect, it } from "vitest";

import { PomCompileError, typeScriptDiagnostic } from "./pomCompileError";

describe("PomCompileError", () => {
  it("is named for its class and states each diagnostic on a line of its message", () => {
    const error = new PomCompileError([
      { text: "a", file: "/p/a.ts", line: 2, column: 3 },
      { text: "b", file: "/p/b.ts" },
      { text: "c" },
    ]);

    expect(error.name).toBe("PomCompileError");
    expect(error.message).toBe("/p/a.ts:2:3: a\n/p/b.ts: b\nc");
  });
});

describe("typeScriptDiagnostic", () => {
  const diagnostic = (overrides: Partial<ts.Diagnostic>): ts.Diagnostic => ({
    category: ts.DiagnosticCategory.Error,
    code: 1,
    file: undefined,
    start: undefined,
    length: undefined,
    messageText: "Broken.",
    ...overrides,
  });
  const file = ts.createSourceFile(
    "/p/page.ts",
    "const a = 1;\nconst b = ;\n",
    {
      languageVersion: ts.ScriptTarget.ES2022,
    }
  );

  it("locates a diagnostic at its file's line and column, counted from 1", () => {
    expect(typeScriptDiagnostic(diagnostic({ file, start: 23 }))).toEqual({
      text: "Broken.",
      file: "/p/page.ts",
      line: 2,
      column: 11,
    });
  });

  it("names only the file of a diagnostic without a start", () => {
    expect(typeScriptDiagnostic(diagnostic({ file }))).toEqual({
      text: "Broken.",
      file: "/p/page.ts",
    });
  });

  it("keeps only the text of a diagnostic without a file", () => {
    expect(typeScriptDiagnostic(diagnostic({}))).toEqual({ text: "Broken." });
  });

  it("puts each message of a chain on its own line", () => {
    expect(
      typeScriptDiagnostic(
        diagnostic({
          messageText: {
            messageText: "Outer.",
            category: ts.DiagnosticCategory.Error,
            code: 1,
            next: [
              {
                messageText: "Inner.",
                category: ts.DiagnosticCategory.Error,
                code: 2,
              },
            ],
          },
        })
      ).text
    ).toBe("Outer.\n  Inner.");
  });
});
