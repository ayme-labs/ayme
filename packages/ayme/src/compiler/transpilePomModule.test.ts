import { describe, expect, it } from "vitest";

import { diagnosticsOf } from "./pomCompileError.testSupport";
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
      },
      { text: "':' expected.", file: fileName, line: 1, column: 13 },
    ]);
  });
});
