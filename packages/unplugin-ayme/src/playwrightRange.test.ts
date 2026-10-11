import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @boundaries-ignore The supported Playwright range is repo-wide data (playwright-range.json).
import playwrightRange from "../../../playwright-range.json";

// The repo root's playwright-range.json is the one source of the supported
// @playwright/test range. Code imports it; this test checks every statement
// that cannot import it, so a Playwright bump is one edit to that file plus
// the statements named here.
const { typesFloor, configLoaderFloor, lastSupported } = playwrightRange;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file: string) => readFileSync(repoRoot + file, "utf8");
const minorOf = (version: string) => Number(version.split(".")[1]);
const peerRange = `>=${typesFloor} <1.${minorOf(lastSupported) + 1}`;

/** Every "X.Y to X.Z" a file states after one of the given lead-ins. */
function statedRanges(file: string, leadIn: string): string[] {
  const found = [
    ...read(file).matchAll(
      new RegExp(`(?:${leadIn})[\\s|]*(\\d+\\.\\d+) to (\\d+\\.\\d+)`, "g")
    ),
  ].map(([, from, to]) => `${from} to ${to}`);
  if (found.length === 0)
    throw new Error(`${file} states no range after ${leadIn}`);
  return found;
}

describe(`the supported @playwright/test range (${peerRange})`, () => {
  it.each(["ayme", "mcp", "inspector", "webmcp"])(
    "is the peer range of packages/%s",
    (name) => {
      const file = `packages/${name}/package.json`;
      const manifest = JSON.parse(read(file)) as {
        peerDependencies?: Record<string, string>;
      };
      expect(manifest.peerDependencies?.["@playwright/test"], file).toBe(
        peerRange
      );
    }
  );

  it.each([
    "docs/guide/start/install.md",
    "packages/ayme/README.md",
    "packages/inspector/README.md",
  ])("is spelled out in %s", (file) => {
    for (const stated of statedRanges(file, "`@playwright/test`"))
      expect.soft(stated, file).toBe(`${typesFloor} to ${lastSupported}`);
  });

  it.each([
    "packages/unplugin-ayme/README.md",
    "docs/guide/reference/build-plugin.md",
    "docs/guide/troubleshooting.md",
  ])("bounds the config loader in %s", (file) => {
    for (const stated of statedRanges(file, "Playwright|`@playwright/test`"))
      expect
        .soft(stated, file)
        .toBe(`${configLoaderFloor} to ${lastSupported}`);
  });

  it("is what Angular ng add installs", () => {
    const file = "packages/angular/src/schematics/ng-add.ts";
    const [, version] =
      /addDependency\("@playwright\/test", "~(\d+\.\d+)\.\d+"/.exec(
        read(file)
      ) ?? [];
    expect(version, file).toBe(lastSupported);
  });

  it("is what every CI Playwright image runs", () => {
    const workflows = readdirSync(repoRoot + ".github/workflows")
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => `.github/workflows/${name}`);
    const images = workflows.flatMap((file) =>
      [
        ...read(file).matchAll(
          /mcr\.microsoft\.com\/playwright:v(\d+\.\d+)\.\d+/g
        ),
      ].map(([image, version]) => ({ file, image, version }))
    );
    expect(images.length).toBeGreaterThan(0);
    for (const { file, image, version } of images)
      expect.soft(version, `${file}: ${image}`).toBe(lastSupported);
  });
});
