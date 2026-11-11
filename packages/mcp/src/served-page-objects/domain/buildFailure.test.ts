import { expect, it } from "vitest";

import { buildErrorLine, buildFailure } from "./buildFailure";

const entry = "/project/.ayme/page-objects.ts";

it("names each failing file, with its line and column, and what failed there", () => {
  const text = buildFailure({
    entry,
    errors: [
      {
        text: "Unexpected end of file",
        location: {
          file: "/project/.ayme/pom/PlainPage.ts",
          line: 22,
          column: 0,
        },
      },
      {
        text: 'Could not resolve "./pom/Missing"',
        location: {
          file: "/project/.ayme/page-objects.ts",
          line: 3,
          column: 26,
        },
      },
    ],
    lastGood: true,
  });

  expect(text).toBe(
    [
      "The Page Objects entry /project/.ayme/page-objects.ts did not build. The page gets the last good build.",
      "  /project/.ayme/pom/PlainPage.ts:22:0: Unexpected end of file",
      '  /project/.ayme/page-objects.ts:3:26: Could not resolve "./pom/Missing"',
    ].join("\n")
  );
});

it("says there is no build to serve when none built yet, and gives an error without a file as it is", () => {
  const text = buildFailure({
    entry,
    errors: [{ text: "The service was stopped", location: null }],
    lastGood: false,
  });

  expect(text).toBe(
    [
      "The Page Objects entry /project/.ayme/page-objects.ts did not build. No build of it has succeeded, so none is served.",
      "  The service was stopped",
    ].join("\n")
  );
});

it("names the file of an error that has no line, without one", () => {
  expect(
    buildErrorLine({
      text: "Could not read TypeScript project configuration",
      location: { file: "/project/.ayme/pom/PlainPage.ts", line: 0, column: 0 },
    })
  ).toBe(
    "/project/.ayme/pom/PlainPage.ts: Could not read TypeScript project configuration"
  );
});
