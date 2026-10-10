import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The supported @playwright/test range is written by hand in several places.
// Nothing generates them from one source, so this test fails when one drifts,
// and a Playwright bump stays red until the ceiling moves everywhere.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file: string) => readFileSync(repoRoot + file, "utf8");

function match(file: string, pattern: RegExp): RegExpMatchArray {
  const found = read(file).match(pattern);
  if (!found) throw new Error(`${file} does not match ${pattern}`);
  return found;
}

const peerRange = (name: string): unknown =>
  (
    JSON.parse(read(`packages/${name}/package.json`)) as {
      peerDependencies?: Record<string, string>;
    }
  ).peerDependencies?.["@playwright/test"];

const peers = ["ayme", "mcp", "inspector", "webmcp"];
// The range most packages state, so the one that drifted is the one named.
const ranges = peers.map((name) => String(peerRange(name)));
const range = ranges.reduce((best, r) =>
  ranges.filter((x) => x === r).length > ranges.filter((x) => x === best).length
    ? r
    : best
);
const [, floor, ceiling] = range
  .match(/^>=1\.(\d+) <1\.(\d+)$/)!
  .map(Number) as [number, number, number];
const last = ceiling - 1;
const minorOf = (version: string) => Number(version.split(".")[1]);
const supported = (version: string) =>
  version.startsWith("1.") &&
  minorOf(version) >= floor &&
  minorOf(version) <= last;

describe(`the supported @playwright/test range (${range})`, () => {
  it.each(peers)("is the peer range of packages/%s", (name) => {
    expect(peerRange(name), `packages/${name}/package.json`).toBe(range);
  });

  it.each([
    "docs/guide/start/install.md",
    "packages/ayme/README.md",
    "packages/inspector/README.md",
  ])("is spelled out in %s", (file) => {
    const [, from, to] = match(
      file,
      /`@playwright\/test`[\s|]*(\d+\.\d+) to (\d+\.\d+)/
    );
    expect(`${from} to ${to}`, file).toBe(`1.${floor} to 1.${last}`);
  });

  it("bounds the build plugin's config loader guard", () => {
    const file = "packages/unplugin-ayme/src/unplugin.ts";
    const guard = new RegExp(
      match(file, /SUPPORTED_PLAYWRIGHT_VERSION = \/(.+)\/;/)[1]!
    );
    const accepted = Array.from(
      { length: ceiling + 5 },
      (_, minor) => minor
    ).filter((minor) => guard.test(`1.${minor}.0`));
    // The loader is a private Playwright import, so it may start above the
    // floor, but it must reach the ceiling and stop there.
    expect(accepted.at(-1), file).toBe(last);
    expect(accepted[0]!, file).toBeGreaterThanOrEqual(floor);
    // Its error messages and the docs that explain it state its bounds.
    for (const stated of [
      file,
      "packages/unplugin-ayme/README.md",
      "docs/guide/reference/build-plugin.md",
      "docs/guide/troubleshooting.md",
    ])
      for (const [, from, to] of read(stated).matchAll(
        /(?:Playwright|`@playwright\/test`) (\d+\.\d+) to (\d+\.\d+)/g
      ))
        expect(`${from} to ${to}`, stated).toBe(
          `1.${accepted[0]} to 1.${last}`
        );
  });

  it("contains the Angular ng add pin", () => {
    const file = "packages/angular/src/schematics/ng-add.ts";
    const [, version] = match(
      file,
      /addDependency\("@playwright\/test", "~(\d+\.\d+\.\d+)"/
    );
    expect(supported(version!), `${file} pins ~${version}`).toBe(true);
  });

  it("is what the packed-consumer test installs and expects", () => {
    const file = "packages/ayme/src/packedConsumer.test.ts";
    const source = read(file);
    expect(source, file).toContain(`? "${range}"`);
    const loop = match(
      file,
      /for \(const version of (?:new Set\()?\[\s*undefined,([^\]]+)\]/
    );
    const looped = [...loop[1]!.matchAll(/"([\d.]+)"/g)].map((m) => m[1]!);
    const pinned = [...source.matchAll(/"@playwright\/test": "([\d.]+)"/g)].map(
      (m) => m[1]!
    );
    for (const version of [...looped, ...pinned])
      expect(supported(version), `${file} installs ${version}`).toBe(true);
    expect(
      looped.map(minorOf),
      `${file} tests the floor and the ceiling`
    ).toEqual(expect.arrayContaining([floor, last]));
  });
});
