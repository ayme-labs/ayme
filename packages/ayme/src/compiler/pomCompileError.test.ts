import { ts, type TypeScript } from "./typescriptApi";
import { describe, expect, it } from "vitest";

import { PomCompileError, typeScriptDiagnostic } from "./pomCompileError";

describe("PomCompileError", () => {
  it("is named for its class and states each diagnostic on a line of its message", () => {
    const error = new PomCompileError([
      { text: "a", file: "/p/a.ts", line: 2, column: 3, lineText: "b = a;" },
      { text: "b", file: "/p/b.ts" },
      { text: "c" },
    ]);

    expect(error.name).toBe("PomCompileError");
    expect(error.message).toBe("/p/a.ts:2:3: a\n/p/b.ts: b\nc");
  });
});

describe("typeScriptDiagnostic", () => {
  const diagnostic = (
    overrides: Partial<TypeScript.Diagnostic>
  ): TypeScript.Diagnostic => ({
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

  it("locates a diagnostic at its file's line and column, counted from 1, with the line's text", () => {
    expect(typeScriptDiagnostic(diagnostic({ file, start: 23 }))).toEqual({
      text: "Broken.",
      file: "/p/page.ts",
      line: 2,
      column: 11,
      lineText: "const b = ;",
    });
  });

  /** The diagnostic at the first `;` of `text`, a file's source. */
  const atSemicolon = (text: string) =>
    typeScriptDiagnostic(
      diagnostic({
        file: ts.createSourceFile("/p/page.ts", text, {
          languageVersion: ts.ScriptTarget.ES2022,
        }),
        start: text.indexOf(";"),
      })
    );

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
    ["LINE SEPARATOR", "\u2028"],
    ["PARAGRAPH SEPARATOR", "\u2029"],
  ])("leaves a line's %s break out of its text", (_name, lineBreak) => {
    expect(
      atSemicolon(`// a${lineBreak}const café = ;${lineBreak}b`)
    ).toMatchObject({ line: 2, column: 14, lineText: "const café = ;" });
  });

  it("counts lines as TypeScript does, across each kind of line break", () => {
    // Lines: "// a", "b", "c", "d", then "const café = ;". U+0085 breaks no line.
    expect(
      atSemicolon("// a\r\nb\rc\u2028d\u2029const café = ;\n")
    ).toMatchObject({ line: 5, column: 14, lineText: "const café = ;" });
    expect(atSemicolon("a\u0085const b = ;")).toMatchObject({
      line: 1,
      column: 13,
      lineText: "a\u0085const b = ;",
    });
  });

  it("counts a U+FEFF left in a file's text as TypeScript does, as a character", () => {
    // TypeScript drops a file's byte order mark as it reads it; one that
    // remains is text, which an editor counts too.
    expect(atSemicolon("\uFEFFconst value = ;\n")).toMatchObject({
      line: 1,
      column: 16,
      lineText: "\uFEFFconst value = ;",
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
