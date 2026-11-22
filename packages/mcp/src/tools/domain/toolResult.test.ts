import { describe, expect, it } from "vitest";

import { pageObjectsNotBuilt } from "./toolResult";

describe("pageObjectsNotBuilt", () => {
  const entry = "/work/.ayme/page-objects.ts";
  const failed = `The Page Objects entry ${entry} did not build, and no build of it has succeeded, so this server serves no Page Objects.`;
  const watching =
    "The server is watching for changes: it rebuilds the entry when a file it read changes.";

  it("states that the server is watching, and gives no advice", () => {
    const error = "/work/.ayme/pom/PlainPage.ts:3:0: Unexpected end of file";
    const text = pageObjectsNotBuilt({ entry, error, watching: true });

    expect(text).toBe(
      [`${failed} The first error: ${error}`, watching].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
    expect(text).not.toContain("tsconfig.json");
  });

  it("keeps TypeScript's no-inputs error and does not say how to cover the entry", () => {
    const error =
      "/work/.ayme/pom/PlainPage.ts: Could not read TypeScript project configuration /work/tsconfig.json: No inputs were found in config file.";
    const text = pageObjectsNotBuilt({ entry, error, watching: true });

    expect(text).toBe(
      [`${failed} The first error: ${error}`, watching].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
  });

  it("states that the server is not watching when the build could not start", () => {
    const error = "needs @ayme-dev/ayme/compiler, which does not resolve";
    const text = pageObjectsNotBuilt({ entry, error, watching: false });

    expect(text).toBe(
      [
        `${failed} The first error: ${error}`,
        "The server is not watching for changes: the build could not start, so no file is watched.",
      ].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
  });
});
