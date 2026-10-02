import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "esbuild";
import { expect, it } from "vitest";

import aymeAngularPlugin from "./angular";

const fixtures = fileURLToPath(
  new URL("./__tests__/fixtures/angular/", import.meta.url)
);

// Stands in for Angular's compiler plugin: registered first, it serves every
// TypeScript file through an `onLoad` with no namespace filter.
const angularCompiler: Plugin = {
  name: "angular-compiler-stand-in",
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => ({
      contents: `console.log("angular:${path.basename(args.path)}");\n${await readFile(args.path, "utf8")}`,
      loader: "ts",
    }));
  },
};

async function bundle(platform: "browser" | "node") {
  const result = await build({
    absWorkingDir: fixtures,
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform,
    external: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"],
    plugins: [
      angularCompiler,
      aymeAngularPlugin({ tsconfigPath: "tsconfig.json" }),
    ],
    logLevel: "silent",
  });
  return {
    code: result.outputFiles[0]!.text,
    inputs: Object.keys(result.metafile.inputs),
  };
}

it("claims only Page Object Model modules and leaves the rest to Angular", async () => {
  const { code, inputs } = await bundle("browser");

  expect(inputs.sort()).toEqual([
    `ayme-pom:${fixtures}CounterPage.ts?ayme-pom`,
    `ayme-pom:${fixtures}SubCounterPage.ts?ayme-pom`,
    "base.ts",
    "counter.component.ts",
    "main.ts",
  ]);
  expect(code).toContain('"className": "CounterPage"');
  expect(code).toContain('"className": "SubCounterPage"');
  // One copy of the base model: the subclass imports the claimed module.
  expect(code.match(/var CounterPage = class/g)).toHaveLength(1);
  expect(code.match(/angular:[\w.]+/g)?.sort()).toEqual([
    "angular:base.ts",
    "angular:counter.component.ts",
    "angular:main.ts",
  ]);
});

it("leaves the server bundle to Angular", async () => {
  const { code, inputs } = await bundle("node");

  expect(inputs.filter((input) => input.startsWith("ayme-pom:"))).toEqual([]);
  expect(code).not.toContain("registerCompiledPom");
});
