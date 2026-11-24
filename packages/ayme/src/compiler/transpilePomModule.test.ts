import { describe, expect, it } from "vitest";

import { diagnosticsOf } from "../../testing/compiler/pomCompileError.testSupport";
import { transpilePomModule } from "./transpilePomModule";

describe("transpilePomModule", () => {
  it("names the line and column of each syntax error", () => {
    const fileName = "/work/.ayme/pom/PlainPage.ts";

    expect(
      diagnosticsOf(() => transpilePomModule("const { = 1 } = {};\n", fileName))
    ).toEqual([
      {
        text: "Property destructuring pattern expected.",
        file: fileName,
        line: 1,
        column: 9,
        lineText: "const { = 1 } = {};",
      },
      {
        text: "':' expected.",
        file: fileName,
        line: 1,
        column: 13,
        lineText: "const { = 1 } = {};",
      },
    ]);
  });

  it("leaves a byte order mark out of a syntax error's line and column, as TypeScript does reading the file", () => {
    const fileName = "/work/.ayme/pom/PlainPage.ts";

    expect(
      diagnosticsOf(() =>
        transpilePomModule("\uFEFFconst value = ;\n", fileName)
      )
    ).toEqual([
      {
        text: "Expression expected.",
        file: fileName,
        line: 1,
        column: 15,
        lineText: "const value = ;",
      },
    ]);
  });
});
