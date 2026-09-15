import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";
import { expect, expectTypeOf, it } from "vitest";
import ts from "typescript";
import type { AymePlaywrightOptions, AymeWebMcpOptions } from "./index";

it("matches the supported subset of Playwright's exported config type", () => {
  expectTypeOf<NonNullable<AymePlaywrightOptions["use"]>>().toEqualTypeOf<
    Partial<
      Pick<
        NonNullable<PlaywrightTestConfig["use"]>,
        "testIdAttribute" | "actionTimeout" | "navigationTimeout"
      >
    >
  >();
});

it("accepts only a boolean publication policy", () => {
  expectTypeOf({ publish: true }).toMatchTypeOf<AymeWebMcpOptions>();
  expectTypeOf({ publish: "yes" }).not.toMatchTypeOf<AymeWebMcpOptions>();
});

it("accepts only a boolean Inspector policy", () => {
  expectTypeOf({ inspector: true }).toMatchTypeOf<AymeWebMcpOptions>();
  expectTypeOf({ inspector: "yes" }).not.toMatchTypeOf<AymeWebMcpOptions>();
});

it(
  "publishes option types that remain strict without Playwright",
  { timeout: 30_000 },
  () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const staging = mkdtempSync(join(tmpdir(), "unplugin-options-"));
    try {
      execFileSync("pnpm", ["exec", "tsdown", "--out-dir", staging], {
        cwd: root,
        stdio: "pipe",
      });
      const declarations = readdirSync(staging).filter((file) =>
        file.endsWith(".d.mts")
      );
      for (const file of declarations) {
        expect(readFileSync(join(staging, file), "utf8")).not.toContain(
          "@playwright/test"
        );
      }
      const entry = resolve(staging, "consumer.mts");
      const source = `import type { AymePlaywrightOptions } from './index.mjs';
const valid: AymePlaywrightOptions = { use: { actionTimeout: 10, navigationTimeout: 0, testIdAttribute: 'data-id' } };
// @ts-expect-error timeout must be numeric
const invalid: AymePlaywrightOptions = { use: { actionTimeout: 'bad' } };
// @ts-expect-error unsupported option
const unsupported: AymePlaywrightOptions = { use: { baseURL: '/' } };`;
      // External dependencies are absent in staging. skipLibCheck isolates the
      // consumer's option checks; unused expect-error directives still fail.
      const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: ts.ModuleKind.NodeNext,
        target: ts.ScriptTarget.ESNext,
      };
      const host = ts.createCompilerHost(options);
      const getSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (
        file,
        languageVersion,
        onError,
        shouldCreateNewSourceFile
      ) =>
        file === entry
          ? ts.createSourceFile(file, source, languageVersion)
          : getSourceFile(
              file,
              languageVersion,
              onError,
              shouldCreateNewSourceFile
            );
      const diagnostics = ts.getPreEmitDiagnostics(
        ts.createProgram([entry], options, host)
      );
      expect(
        diagnostics.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        )
      ).toEqual([]);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
);
