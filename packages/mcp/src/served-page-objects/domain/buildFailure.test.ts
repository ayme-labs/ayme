import { expect, it } from "vitest";

import { buildErrorLine, buildFailure } from "./buildFailure";

const entry = "/project/ayme/page-objects.ts";

it("names the error's line and column counted from 1, as editors do", () => {
  expect(
    buildErrorLine({
      text: "')' expected.",
      location: { file: entry, line: 3, column: 0 },
    })
  ).toBe(`${entry}:3:1: ')' expected.`);
});

it("names each failing file, with its line and column, and what failed there", () => {
  const text = buildFailure({
    entry,
    errors: [
      {
        text: "Unexpected end of file",
        location: {
          file: "/project/ayme/pom/PlainPage.ts",
          line: 22,
          column: 0,
        },
      },
      {
        text: 'Could not resolve "./pom/Missing"',
        location: {
          file: "/project/ayme/page-objects.ts",
          line: 3,
          column: 26,
        },
      },
    ],
    lastGood: true,
  });

  expect(text).toBe(
    [
      "The Page Objects entry /project/ayme/page-objects.ts did not build. The page gets the last good build.",
      "  /project/ayme/pom/PlainPage.ts:22:1: Unexpected end of file",
      '  /project/ayme/page-objects.ts:3:27: Could not resolve "./pom/Missing"',
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
      "The Page Objects entry /project/ayme/page-objects.ts did not build. No build of it has succeeded, so none is served.",
      "  The service was stopped",
    ].join("\n")
  );
});

it("names the file of an error that has no line, without one", () => {
  expect(
    buildErrorLine({
      text: "Could not read TypeScript project configuration",
      location: { file: "/project/ayme/pom/PlainPage.ts", line: 0, column: 0 },
    })
  ).toBe(
    "/project/ayme/pom/PlainPage.ts: Could not read TypeScript project configuration"
  );
});

it("names the column an editor counts after non-ASCII text, from esbuild's count of UTF-8 bytes on the error's line", () => {
  // "    return \"café ☕ 😀\" + this.note.textContent(" is 47 UTF-16 code
  // units and 52 UTF-8 bytes: é is 2 bytes, ☕ 3 and 😀 4.
  const lineText = '    return "café ☕ 😀" + this.note.textContent(;';
  expect(
    buildErrorLine({
      text: "')' expected.",
      location: { file: entry, line: 19, column: 52, lineText },
    })
  ).toBe(`${entry}:19:48: ')' expected.`);
});

it("names esbuild's column as it is when the error has no line text", () => {
  expect(
    buildErrorLine({
      text: "')' expected.",
      location: { file: entry, line: 19, column: 52 },
    })
  ).toBe(`${entry}:19:53: ')' expected.`);
});

it("names esbuild's column as it is when the error's line text is empty, as for a line esbuild did not read", () => {
  expect(
    buildErrorLine({
      text: "unreadable",
      location: { file: entry, line: 2, column: 4, lineText: "" },
    })
  ).toBe(`${entry}:2:5: unreadable`);
});

it("counts a U+FEFF that starts the error's line, as TypeScript counts it", () => {
  // "\uFEFFconst value = " is 15 UTF-16 code units and 17 UTF-8 bytes.
  expect(
    buildErrorLine({
      text: "Expression expected.",
      location: {
        file: entry,
        line: 2,
        column: 17,
        lineText: "\uFEFFconst value = ;",
      },
    })
  ).toBe(`${entry}:2:16: Expression expected.`);
});
