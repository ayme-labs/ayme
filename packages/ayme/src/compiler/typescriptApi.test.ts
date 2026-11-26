import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import projectTypeScript from "typescript";

import { TYPESCRIPT6, compilerApi, ts } from "./typescriptApi";

const missing = Object.assign(
  (): unknown => {
    throw new Error("loaded a package it could not resolve");
  },
  {
    resolve(id: string): string {
      throw new Error(`Cannot find module '${id}'`);
    },
  }
);

describe("compilerApi", () => {
  it("only uses the TypeScript 6 compatibility API with TypeScript 7", () => {
    if (projectTypeScript.version.startsWith("7.")) {
      expect(ts.version).toMatch(/^6\./);
    } else {
      expect(ts).toBe(projectTypeScript);
    }
  });

  it("needs no compatibility package before TypeScript 7", () => {
    expect(compilerApi("6.0.3", missing)).toBe(projectTypeScript);
  });

  it("names the package to install when TypeScript 7 has none beside it", () => {
    expect(() => compilerApi("7.0.2", missing)).toThrow(
      new Error(
        "[ayme] TypeScript 7.0.2 is installed without @typescript/typescript6, which the Page Object compiler needs with TypeScript 7: install @typescript/typescript6 in the project."
      )
    );
  });

  // Browser-only installs download no TypeScript (ADR-0065).
  it("is an optional peer of the package, never a dependency", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(manifest.dependencies?.[TYPESCRIPT6]).toBeUndefined();
    expect(manifest.peerDependencies[TYPESCRIPT6]).toBe("^6.0.2");
    expect(manifest.peerDependenciesMeta[TYPESCRIPT6]?.optional).toBe(true);
  });
});
