import { fileURLToPath } from "node:url";

import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AymeReport } from "./options";
import { ayme } from "./vite";

// Integration: a Vite build lists, once it ends, the public methods of its
// Page Object Models that are not tools.

const entry = fileURLToPath(
  new URL("./fixtures/unmarkedMethodsPom.ts", import.meta.url)
);

async function buildReport(report?: AymeReport) {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await build({
    configFile: false,
    logLevel: "silent",
    plugins: [ayme(report === undefined ? {} : { report })],
    build: {
      write: false,
      rolldownOptions: {
        input: entry,
        external: [/^@ayme-dev\//, /^@playwright\//],
      },
    },
  });
  return info.mock.calls.map(([message]) => String(message));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the build report", () => {
  it("lists the methods whose parameters have no schema by default", async () => {
    expect(await buildReport()).toEqual([
      [
        "[ayme] Page Object methods that are not tools:",
        "  ItemPom.select: no @ayme.action mark, and parameter at has the unsupported type Date",
        "  UnmarkedMethodsPom.each: no @ayme.action mark, and parameter callback has the unsupported type (row: Locator) => void",
        "  UnmarkedMethodsPom.open: no @ayme.action mark, and a parameter is destructured",
      ].join("\n"),
    ]);
  });

  it("also lists unmarked methods that could be tools with `all`", async () => {
    // Actions, Page Object Children, and private and static methods are no
    // candidates.
    expect(await buildReport("all")).toEqual([
      [
        "[ayme] Page Object methods that are not tools:",
        "  ItemPom.select: no @ayme.action mark, and parameter at has the unsupported type Date",
        "  UnmarkedMethodsPom.each: no @ayme.action mark, and parameter callback has the unsupported type (row: Locator) => void",
        "  UnmarkedMethodsPom.open: no @ayme.action mark, and a parameter is destructured",
        "  UnmarkedMethodsPom.row: no @ayme.action mark",
      ].join("\n"),
    ]);
  });

  it("prints nothing with `none`", async () => {
    expect(await buildReport("none")).toEqual([]);
  });

  it("rejects an unknown report option", () => {
    expect(() => ayme({ report: "some" as AymeReport })).toThrow(
      'report must be "none", "unsupported" or "all"'
    );
  });
});
