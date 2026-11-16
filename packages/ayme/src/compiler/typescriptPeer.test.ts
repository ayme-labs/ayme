import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SUPPORTED_TYPESCRIPT,
  assertSupportedTypeScript,
} from "./typescriptPeer";

describe("assertSupportedTypeScript", () => {
  it("states the range package.json's peer states", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { peerDependencies: Record<string, string> };
    expect(manifest.peerDependencies.typescript).toBe(SUPPORTED_TYPESCRIPT);
  });

  it("accepts the versions in the range", () => {
    for (const version of ["5.4.5", "5.9.3", "6.0.3", "6.1.0-dev.20261101"])
      expect(() => assertSupportedTypeScript(version)).not.toThrow();
  });

  it("names a version outside the range, and the range", () => {
    for (const version of ["4.9.5", "5.3.3", "7.0.0"])
      expect(() => assertSupportedTypeScript(version)).toThrow(
        new Error(
          `[ayme] TypeScript ${version} is installed, and the Page Object compiler supports TypeScript >=5.4 <7.`
        )
      );
  });
});
