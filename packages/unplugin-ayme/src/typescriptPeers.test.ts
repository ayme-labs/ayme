import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Manifest = {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const manifest = (url: URL) =>
  JSON.parse(readFileSync(url, "utf8")) as Manifest;
const plugin = manifest(new URL("../package.json", import.meta.url));
// The plugin compiles with @ayme-dev/ayme's compiler, so it asks for the same TypeScript.
const ayme = manifest(new URL("../../ayme/package.json", import.meta.url));

describe("the TypeScript peers", () => {
  it.each(["typescript", "@typescript/typescript6"])(
    "states the same %s range as @ayme-dev/ayme",
    (name) => {
      expect(plugin.peerDependencies[name]).toBe(ayme.peerDependencies[name]);
    }
  );

  // Only TypeScript 7 projects need the compatibility package (ADR-0065).
  it("keeps @typescript/typescript6 an optional peer, never a dependency", () => {
    expect(plugin.dependencies?.["@typescript/typescript6"]).toBeUndefined();
    expect(
      plugin.peerDependenciesMeta["@typescript/typescript6"]?.optional
    ).toBe(true);
  });
});
