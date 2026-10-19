import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, context, type Plugin } from "esbuild";
import { expect, it, vi } from "vitest";

const { createPomProgram } = vi.hoisted(() => ({
  createPomProgram: vi.fn(),
}));

vi.mock("./pomProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pomProgram")>();
  createPomProgram.mockImplementation(actual.createPomProgram);
  return { ...actual, createPomProgram };
});

import aymeAngularPlugin, { type AymeAngularOptions } from "./angular";

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

async function bundle(platform: "browser" | "node", workspace = fixtures) {
  const result = await build({
    absWorkingDir: workspace,
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform,
    external: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"],
    plugins: [
      angularCompiler,
      aymeAngularPlugin({ include: true, tsconfigPath: "tsconfig.json" }),
    ],
    logLevel: "silent",
  });
  return {
    code: result.outputFiles[0]!.text,
    inputs: Object.keys(result.metafile.inputs),
  };
}

// A throwaway workspace, for files the repository cannot hold, like a
// `node_modules` directory.
async function workspace(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "ayme-angular-"));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  return root;
}

const pomSource = (className: string) => `import { ayme } from "@ayme-dev/ayme";

@ayme
export class ${className} {
  @ayme.action({ description: "Do it." })
  doIt() {}
}
`;
const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    experimentalDecorators: true,
    skipLibCheck: true,
  },
});

// The file's first bundle builds the fixture's TypeScript program cold: 1.5 s
// locally, 15.2 to 15.9 s on CI beside the other Turbo tasks.
it("claims only Page Object Model modules, relative or aliased, and leaves the rest to Angular", async () => {
  const { code, inputs } = await bundle("browser");

  expect(inputs.sort()).toEqual([
    `ayme-pom:${fixtures}CounterPage.ts?ayme-pom`,
    `ayme-pom:${fixtures}SubCounterPage.ts?ayme-pom`,
    `ayme-pom:${fixtures}poms/AliasedPage.ts?ayme-pom`,
    "base.ts",
    "counter.component.ts",
    "main.ts",
  ]);
  expect(code).toContain('"className": "CounterPage"');
  expect(code).toContain('"className": "SubCounterPage"');
  expect(code).toContain('"className": "AliasedPage"');
  // One copy of the base model: the subclass imports the claimed module.
  expect(code.match(/var CounterPage = class/g)).toHaveLength(1);
  expect(code.match(/angular:[\w.]+/g)?.sort()).toEqual([
    "angular:base.ts",
    "angular:counter.component.ts",
    "angular:main.ts",
  ]);
}, 30_000);

it("builds one Program per tsconfig project and build, and a rebuild starts afresh", async () => {
  const builds = await context({
    absWorkingDir: fixtures,
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    format: "esm",
    external: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"],
    plugins: [
      angularCompiler,
      aymeAngularPlugin({ include: true, tsconfigPath: "tsconfig.json" }),
    ],
    logLevel: "silent",
  });
  try {
    createPomProgram.mockClear();
    // Three Page Object Model modules of one project.
    await builds.rebuild();
    expect(createPomProgram).toHaveBeenCalledTimes(1);

    await builds.rebuild();
    expect(createPomProgram).toHaveBeenCalledTimes(2);
  } finally {
    await builds.dispose();
  }
}, 30_000);

it("resolves the runtime to its absent entry and compiles stand-ins in a build without Ayme, the default", async () => {
  const result = await build({
    absWorkingDir: fixtures,
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    external: ["@playwright/test"],
    plugins: [
      angularCompiler,
      aymeAngularPlugin({ tsconfigPath: "tsconfig.json" }),
    ],
    logLevel: "silent",
  });
  const code = result.outputFiles[0]!.text;
  const inputs = Object.keys(result.metafile.inputs);

  expect(inputs.some((input) => input.endsWith("/dist/absent.mjs"))).toBe(true);
  expect(inputs.some((input) => input.endsWith("/dist/index.mjs"))).toBe(false);
  expect(code).toContain("Ayme was removed from this build.");
  expect(code).toMatch(
    /absentPageObject\("CounterPage", \{ "actions": \["increment", "setMode"\]/
  );
  expect(code).not.toContain("registerCompiledPom");
  expect(code).not.toContain("Increment the counter.");
  expect(code).not.toContain("Waiting for the WebMCP driver.");
}, 30_000);

it("resolves the framework packages to their absent entries in a build without Ayme", async () => {
  const frameworks = ["vue", "react", "svelte", "angular"];
  // Stand-ins for the installed packages: each entry names itself.
  const root = await workspace({
    "tsconfig.json": tsconfig,
    "main.ts": frameworks
      .map(
        (framework) =>
          `import { entry as ${framework} } from "@ayme-dev/${framework}";\nconsole.log(${framework});\n`
      )
      .join(""),
    ...Object.fromEntries(
      frameworks.flatMap((framework) => [
        [
          `node_modules/@ayme-dev/${framework}/package.json`,
          JSON.stringify({
            name: `@ayme-dev/${framework}`,
            exports: { ".": "./index.js", "./absent": "./absent.js" },
          }),
        ],
        [
          `node_modules/@ayme-dev/${framework}/index.js`,
          `export const entry = "${framework} index";\n`,
        ],
        [
          `node_modules/@ayme-dev/${framework}/absent.js`,
          `export const entry = "${framework} absent";\n`,
        ],
      ])
    ),
  });
  try {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["main.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      plugins: [
        angularCompiler,
        aymeAngularPlugin({ tsconfigPath: "tsconfig.json" }),
      ],
      logLevel: "silent",
    });
    const code = result.outputFiles[0]!.text;
    for (const framework of frameworks) {
      expect(code).toContain(`"${framework} absent"`);
      expect(code).not.toContain(`"${framework} index"`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("leaves the server bundle to Angular", async () => {
  const { code, inputs } = await bundle("node");

  expect(inputs.filter((input) => input.startsWith("ayme-pom:"))).toEqual([]);
  expect(code).not.toContain("registerCompiledPom");
});

it("never claims a Page Object Model under node_modules", async () => {
  const root = await workspace({
    "tsconfig.json": tsconfig,
    "main.ts":
      'import { ForeignPage } from "foreign-poms";\nconsole.log(ForeignPage);\n',
    "node_modules/foreign-poms/package.json": JSON.stringify({
      name: "foreign-poms",
      main: "index.ts",
    }),
    "node_modules/foreign-poms/index.ts": pomSource("ForeignPage"),
  });
  try {
    const { code, inputs } = await bundle("browser", root);

    expect(inputs.filter((input) => input.startsWith("ayme-pom:"))).toEqual([]);
    expect(code).not.toContain("registerCompiledPom");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("surfaces compiler diagnostics, like the error for a destructured action parameter", async () => {
  const root = await workspace({
    "tsconfig.json": tsconfig,
    "main.ts":
      'import { SavePage } from "./SavePage";\nconsole.log(SavePage);\n',
    "SavePage.ts": `import { ayme } from "@ayme-dev/ayme";

@ayme
export class SavePage {
  @ayme.action
  async save({ name }: { name: string }) {
    void name;
  }
}
`,
  });
  try {
    await expect(bundle("browser", root)).rejects.toThrow(
      "Page Object Action SavePage.save needs identifier parameter names."
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  [{ tsconfig: "tsconfig.json" }, "has no option(s): tsconfig."],
  // custom-esbuild's string form passes the builder's options.
  [
    { browser: "src/main.ts", tsConfig: "tsconfig.app.json" },
    "has no option(s): browser, tsConfig. Referenced in angular.json as a plain string",
  ],
  [{ tsconfigPath: 1 }, "tsconfigPath must be a string"],
  [{ include: "yes" }, "include must be a boolean"],
])("rejects the options %j", (options, message) => {
  const create = () => aymeAngularPlugin(options as AymeAngularOptions);
  expect(create).toThrow(TypeError);
  expect(create).toThrow(message);
});
