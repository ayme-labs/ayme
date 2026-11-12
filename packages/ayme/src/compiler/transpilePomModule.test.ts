import { describe, expect, it } from "vitest";

import { transpilePomModule } from "./transpilePomModule";

describe("transpilePomModule", () => {
  it("names the line and column of each syntax error", () => {
    const fileName = "/work/.ayme/pom/PlainPage.ts";

    expect(() => transpilePomModule("const { = 1 } = {};\n", fileName)).toThrow(
      new Error(
        [
          `Could not transpile Ayme POM ${fileName}:`,
          `${fileName}:1:9: Property destructuring pattern expected.`,
          `${fileName}:1:13: ':' expected.`,
        ].join("\n")
      )
    );
  });
});
