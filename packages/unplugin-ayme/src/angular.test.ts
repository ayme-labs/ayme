import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, context, type Plugin } from "esbuild";
import { expect, it, vi } from "vitest";

// What the adapter asks of its compiler, in order: a compile keeps the
// Programs, an invalidate drops them (ADR-0036).
const { compilerCalls } = vi.hoisted(() => ({
  compilerCalls: [] as ("compile" | "invalidate")[],
}));

vi.mock("@ayme-dev/ayme/compiler", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ayme-dev/ayme/compiler")>();
  return {
    ...actual,
    createPomCompiler: (
      ...args: Parameters<typeof actual.createPomCompiler>
    ) => {
      const compiler = actual.createPomCompiler(...args);
      return {
        ...compiler,
        compile(...compileArgs: Parameters<typeof compiler.compile>) {
          compilerCalls.push("compile");
          return compiler.compile(...compileArgs);
        },
        invalidate() {
          compilerCalls.push("invalidate");
          compiler.invalidate();
        },
      };
    },
  };
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

it("keeps the compiler's Programs for the length of a build, and a rebuild starts afresh", async () => {
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
  const oneBuild = () => {
    const calls = compilerCalls.splice(0);
    expect(calls[0]).toBe("invalidate");
    expect(calls.at(-1)).toBe("invalidate");
    // Three Page Object Model modules of one project, and the modules that
    // declare none, compile with the Programs kept.
    expect(
      calls.slice(1, -1).filter((call) => call === "compile").length
    ).toBeGreaterThanOrEqual(3);
    expect(calls.slice(1, -1)).not.toContain("invalidate");
  };
  try {
    compilerCalls.splice(0);
    await builds.rebuild();
    oneBuild();

    await builds.rebuild();
    oneBuild();
  } finally {
    await builds.dispose();
  }
}, 30_000);

it("in watch mode, rebuilds after an edit to a Page Object Model module that its tsconfig does not list", async () => {
  const root = await workspace({
    // As the tsconfig above a project's `.ayme` folder may not list it.
    "tsconfig.json": JSON.stringify({
      ...JSON.parse(tsconfig),
      files: ["main.ts"],
    }),
    "main.ts":
      'import { EditedPage } from "./EditedPage";\nconsole.log(EditedPage);\n',
    "EditedPage.ts": pomSource("EditedPage"),
  });
  const ends: string[] = [];
  const builds = await context({
    absWorkingDir: root,
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    format: "esm",
    external: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"],
    plugins: [
      aymeAngularPlugin({ include: true }),
      {
        name: "ends",
        setup(build) {
          build.onEnd(({ outputFiles }) => {
            ends.push(outputFiles?.[0]?.text ?? "");
          });
        },
      },
    ],
    logLevel: "silent",
  });
  try {
    await builds.watch();
    // The first build builds the project's Program, seconds on CI.
    await vi.waitFor(() => expect(ends).toHaveLength(1), { timeout: 10_000 });

    await writeFile(
      path.join(root, "EditedPage.ts"),
      pomSource("EditedPage").replace(
        "doIt() {}",
        'doIt() {}\n\n  @ayme.action({ description: "Undo it." })\n  undoIt() {}'
      )
    );

    await vi.waitFor(() => expect(ends.at(-1)).toContain('"undoIt"'), {
      timeout: 10_000,
    });
  } finally {
    await builds.dispose();
    await rm(root, { recursive: true, force: true });
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

it("surfaces compiler diagnostics, like the error for an unsupported parameter type", async () => {
  const root = await workspace({
    "tsconfig.json": tsconfig,
    "main.ts":
      'import { SavePage } from "./SavePage";\nconsole.log(SavePage);\n',
    "SavePage.ts": `import { ayme } from "@ayme-dev/ayme";

@ayme
export class SavePage {
  @ayme.action
  async save(at: Date) {
    void at;
  }
}
`,
  });
  try {
    await expect(bundle("browser", root)).rejects.toThrow(
      "Unsupported Page Object Tool input type for SavePage.save(at): Date."
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

it.each([
  [
    "include unset",
    {},
    "[ayme] Ayme is not in this build: include is not set.",
  ],
  [
    "include false",
    { include: false },
    "[ayme] Ayme is not in this build: include is false.",
  ],
  [
    "include true",
    { include: true },
    "[ayme] Ayme is in this build: include is true.",
  ],
])(
  "prints once per build whether Ayme is in it, with %s",
  async (_, options, line) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await build({
        absWorkingDir: fixtures,
        entryPoints: ["main.ts"],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        external: ["@ayme-dev/*", "@playwright/*"],
        plugins: [
          angularCompiler,
          aymeAngularPlugin({ ...options, tsconfigPath: "tsconfig.json" }),
        ],
        logLevel: "silent",
      });
      expect(
        info.mock.calls
          .map(([message]) => String(message))
          .filter((message) => message.startsWith("[ayme] Ayme"))
      ).toEqual([line]);
    } finally {
      info.mockRestore();
    }
  },
  30_000
);
