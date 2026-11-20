import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as esbuild from "esbuild";
import { expect, it, vi } from "vitest";

import { PageObjectsBuildError, buildErrorLine } from "../domain/buildFailure";
import {
  buildOutcomes,
  failedPageObjects,
  pageObjectModels,
  type PageObjectsBuild,
  watchPageObjects,
} from "./pageObjectsBuild";

const entry = "/project/.ayme/page-objects.ts";

/** The diagnostics of a compile error, as `ayme mcp` reads them. */
type PomDiagnostics = Parameters<typeof pageObjectModels>[1] extends new (
  ...args: never[]
) => { diagnostics: infer Diagnostics }
  ? Diagnostics
  : never;

/** The compiler entry's error class, as `ayme mcp` reads it. */
class PomCompileError extends Error {
  constructor(readonly diagnostics: PomDiagnostics) {
    super(diagnostics.map(({ text }) => text).join("\n"));
  }
}

const models = (compiler: Parameters<typeof pageObjectModels>[0]) =>
  pageObjectModels(compiler, PomCompileError);

const buildWith = (modules: PageObjectsBuild["modules"]) =>
  Promise.resolve<PageObjectsBuild>({
    modules,
    onBuilt: () => () => {},
    close: async () => {},
  });

it("gives the first error of a build of the entry that has never succeeded", async () => {
  const failing = buildWith(async () => {
    throw new PageObjectsBuildError({
      entry,
      lastGood: false,
      errors: [
        {
          text: "Unexpected end of file",
          location: {
            file: "/project/.ayme/pom/PlainPage.ts",
            line: 22,
            column: 0,
          },
        },
        { text: "Second error", location: null },
      ],
    });
  });

  expect(await failedPageObjects(entry, failing)).toEqual({
    entry,
    error: "/project/.ayme/pom/PlainPage.ts:22:1: Unexpected end of file",
    watching: true,
  });
});

it("gives why the build could not start", async () => {
  const unstarted = Promise.reject<PageObjectsBuild>(
    new Error("needs @ayme-dev/ayme/compiler, which does not resolve")
  );

  expect(await failedPageObjects(entry, unstarted)).toEqual({
    entry,
    error: "needs @ayme-dev/ayme/compiler, which does not resolve",
    watching: false,
  });
});

it("gives the message of another error the started build rejects with", async () => {
  const failing = buildWith(async () => {
    throw new Error("The service was stopped");
  });

  expect(await failedPageObjects(entry, failing)).toEqual({
    entry,
    error: "The service was stopped",
    watching: true,
  });
});

it("gives nothing once a build has succeeded", async () => {
  expect(
    await failedPageObjects(
      entry,
      buildWith(async () => new Map())
    )
  ).toBeUndefined();
});

/** The callbacks a plugin registers, from a fake esbuild build. */
function setUp(plugin: esbuild.Plugin) {
  let onStart!: () => void;
  let onLoad!: (args: { path: string }) => Promise<unknown>;
  let onEnd!: (result: Partial<esbuild.BuildResult>) => void;
  void plugin.setup({
    onStart: (callback: typeof onStart) => (onStart = callback),
    onLoad: (_options: unknown, callback: typeof onLoad) => (onLoad = callback),
    onEnd: (callback: typeof onEnd) => (onEnd = callback),
  } as unknown as esbuild.PluginBuild);
  return { onStart, onLoad, onEnd };
}

const pomFile = async (source: string) => {
  const file = join(await mkdtemp(join(tmpdir(), "ayme-pom-")), "Page.ts");
  await writeFile(file, source);
  return file;
};

it("loads a Page Object Model as the compiler compiles it, watching its dependencies", async () => {
  const file = await pomFile("class Page {}");
  const compile = vi.fn(() => ({
    code: "compiled",
    dependencies: ["/dep.ts"],
  }));
  const { onLoad } = setUp(models({ compile, invalidate: () => {} }));

  expect(await onLoad({ path: file })).toEqual({
    contents: "compiled",
    loader: "js",
    watchFiles: [file, "/dep.ts"],
  });
  expect(compile).toHaveBeenCalledWith(file, "class Page {}", {
    emit: "js",
    onDependencies: expect.any(Function),
  });
});

it("reports any other error of the compile against the file it compiled, and keeps watching it and what the compile read", async () => {
  const file = await pomFile("class Page {}");
  const { onLoad } = setUp(
    models({
      compile: (_file, _source, { onDependencies }) => {
        onDependencies?.(["/project/tsconfig.json"]);
        throw new Error("Could not read TypeScript project configuration");
      },
      invalidate: () => {},
    })
  );

  expect(await onLoad({ path: file })).toEqual({
    errors: [
      {
        text: "Could not read TypeScript project configuration",
        location: { file },
      },
    ],
    watchFiles: [file, "/project/tsconfig.json"],
  });
});

it("reports each diagnostic of a compile error where the compiler locates it", async () => {
  const file = await pomFile("class Page {}");
  const { onLoad } = setUp(
    models({
      compile: (_file, _source, { onDependencies }) => {
        onDependencies?.(["/project/tsconfig.json"]);
        throw new PomCompileError([
          {
            text: "unsupported",
            file: "/project/Child.ts",
            line: 8,
            column: 14,
            lineText: "  async pick(callback: () => void) {",
          },
          { text: "no position", file: "/project/tsconfig.json" },
          { text: "no file" },
        ]);
      },
      invalidate: () => {},
    })
  );

  expect(await onLoad({ path: file })).toEqual({
    errors: [
      {
        text: "unsupported",
        location: {
          file: "/project/Child.ts",
          line: 8,
          column: 13,
          // esbuild draws its code frame from this line, which it has not loaded.
          lineText: "  async pick(callback: () => void) {",
        },
      },
      { text: "no position", location: { file: "/project/tsconfig.json" } },
      { text: "no file", location: { file } },
    ],
    watchFiles: [file, "/project/tsconfig.json"],
  });
});

it("gives esbuild a diagnostic's column in UTF-8 bytes, as esbuild counts it", async () => {
  const file = await pomFile("const café = ;\n");
  const { onLoad } = setUp(
    models({
      compile: () => {
        // TypeScript counts the column in UTF-16 code units, from 1.
        throw new PomCompileError([
          {
            text: "Expression expected.",
            file,
            line: 1,
            column: 14,
            lineText: "const café = ;",
          },
        ]);
      },
      invalidate: () => {},
    })
  );

  const result = (await onLoad({ path: file })) as {
    errors: esbuild.PartialMessage[];
  };
  expect(result).toMatchObject({
    errors: [
      {
        text: "Expression expected.",
        // "const café = " is 13 code units and 14 bytes.
        location: { file, line: 1, column: 14, lineText: "const café = ;" },
      },
    ],
  });
  // The reported line counts the column as TypeScript and editors do.
  expect(
    buildErrorLine(result.errors[0] as Parameters<typeof buildErrorLine>[0])
  ).toBe(`${file}:1:14: Expression expected.`);
});

it("reports esbuild's own error on the first line of a file with a byte order mark at the column an editor counts", async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-pom-esbuild-bom-"))
  );
  await writeFile(join(folder, "entry.ts"), "\uFEFFconst value = ;\n");
  const outcomes = buildOutcomes({
    entry: join(folder, "entry.ts"),
    folder,
    outdir: join(folder, "out"),
    log: vi.fn(),
  });
  try {
    const failure = await esbuild
      .build({
        absWorkingDir: folder,
        entryPoints: ["entry.ts"],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [outcomes.plugin],
      })
      .catch((error: esbuild.BuildFailure) => error);
    // esbuild counts the mark's three bytes in the column and leaves it out of the line.
    expect(failure.errors).toMatchObject([
      { location: { line: 1, column: 17, lineText: "const value = ;" } },
    ]);
    const error = (await outcomes
      .modules()
      .catch((e: unknown) => e)) as PageObjectsBuildError;
    expect(buildErrorLine(error.errors[0]!)).toBe(
      `${join(folder, "entry.ts")}:1:15: ${failure.errors[0]!.text}`
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it("reports esbuild's own error after non-ASCII text at the column an editor counts", async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-pom-esbuild-"))
  );
  const line = 'export const note = "café ☕ 😀" +;';
  await writeFile(join(folder, "entry.ts"), `${line}\n`);
  const log = vi.fn();
  const outcomes = buildOutcomes({
    entry: join(folder, "entry.ts"),
    folder,
    outdir: join(folder, "out"),
    log,
  });
  try {
    const failure = await esbuild
      .build({
        absWorkingDir: folder,
        entryPoints: ["entry.ts"],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [outcomes.plugin],
      })
      .catch((error: esbuild.BuildFailure) => error);
    // esbuild's own error counts its column in UTF-8 bytes, and carries its line.
    expect(failure.errors).toMatchObject([
      {
        location: {
          line: 1,
          column: Buffer.byteLength(line.slice(0, line.indexOf(";"))),
          lineText: line,
        },
      },
    ]);
    const error = (await outcomes
      .modules()
      .catch((e: unknown) => e)) as PageObjectsBuildError;
    expect(buildErrorLine(error.errors[0]!)).toBe(
      `${join(folder, "entry.ts")}:1:${line.indexOf(";") + 1}: ${failure.errors[0]!.text}`
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it("leaves to esbuild a module the compiler does not compile, and one in node_modules", async () => {
  const compile = vi.fn(() => null);
  const { onLoad } = setUp(models({ compile, invalidate: () => {} }));

  expect(await onLoad({ path: await pomFile("export {}") })).toBeUndefined();
  expect(
    await onLoad({ path: join("/x", "node_modules", "y", "index.ts") })
  ).toBeUndefined();
  expect(compile).toHaveBeenCalledOnce();
});

it("rejects with each error of a failed first build, its file resolved from the entry's folder, and logs it", async () => {
  const log = vi.fn();
  const outcomes = buildOutcomes({
    entry,
    folder: "/project/.ayme",
    outdir: "/project/.ayme/ayme-served",
    log,
  });
  const { onEnd } = setUp(outcomes.plugin);

  onEnd({
    errors: [
      {
        text: "Unexpected end of file",
        location: { file: "pom/PlainPage.ts", line: 22, column: 0 },
      },
      { text: "The service was stopped", location: null },
    ] as esbuild.Message[],
  });

  const error = await outcomes.modules().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PageObjectsBuildError);
  expect((error as PageObjectsBuildError).errors).toEqual([
    {
      text: "Unexpected end of file",
      location: {
        file: "/project/.ayme/pom/PlainPage.ts",
        line: 22,
        column: 0,
      },
    },
    { text: "The service was stopped", location: null },
  ]);
  expect((error as Error).message).toContain(
    "No build of it has succeeded, so none is served."
  );
  expect(log).toHaveBeenCalledWith((error as Error).message);
});

it("keeps the last good build after a later build fails, and says so in the log", async () => {
  const log = vi.fn();
  const outcomes = buildOutcomes({
    entry,
    folder: "/project/.ayme",
    outdir: "/project/.ayme/ayme-served",
    log,
  });
  const { onEnd } = setUp(outcomes.plugin);

  onEnd({
    errors: [],
    outputFiles: [
      { path: "/project/.ayme/ayme-served/entry.js", text: "good" },
    ] as esbuild.OutputFile[],
  });
  onEnd({
    errors: [
      { text: "Unexpected end of file", location: null },
    ] as esbuild.Message[],
  });

  expect(await outcomes.modules()).toEqual(new Map([["entry.js", "good"]]));
  expect(log).toHaveBeenLastCalledWith(
    expect.stringContaining("did not build. The page gets the last good build.")
  );
  expect(await failedPageObjects(entry, buildWith(outcomes.modules))).toBe(
    undefined
  );
});

it("watches only the file it compiled when the compile throws before it reads anything", async () => {
  const file = await pomFile("class Page {}");
  const { onLoad } = setUp(
    models({
      compile: () => {
        throw new Error("The service was stopped");
      },
      invalidate: () => {},
    })
  );

  expect(await onLoad({ path: file })).toMatchObject({ watchFiles: [file] });
});

// Compiled modules have no source map; resolution errors must not quote their coordinates.
it("omits generated positions for an unresolved import after statements and non-ASCII", async () => {
  const source =
    'const before = 1;\nconst é = "😀"; import { nope } from "./does-not-exist"; nope();';
  const file = await realpath(await pomFile(source));
  const outcomes = buildOutcomes({
    entry: file,
    folder: join(file, ".."),
    outdir: join(file, "..", "out"),
    log: () => {},
  });
  try {
    await esbuild
      .build({
        entryPoints: [file],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [
          models({
            compile: () => ({
              code: '\n\nimport { nope } from "./does-not-exist"; nope();',
              dependencies: [],
            }),
            invalidate: () => {},
          }),
          outcomes.plugin,
        ],
      })
      .catch(() => {});
    expect(await failedPageObjects(file, buildWith(outcomes.modules))).toEqual({
      entry: file,
      error: `${file}: Could not resolve "./does-not-exist"`,
      watching: true,
    });
  } finally {
    await rm(join(file, ".."), { recursive: true, force: true });
  }
});

it.each(["Page.ts", "Child.ts"])(
  "reports a compile error in %s through esbuild once, at its own position, even in a module it compiled",
  async (kind) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "ayme-pom-error-"))
    );
    const entry = join(root, "entry.ts");
    const page = join(root, "Page.ts");
    const child = join(root, "Child.ts");
    const file = kind === "Child.ts" ? child : page;
    const text =
      "Unsupported Page Object Tool input type for Child.pick(callback): () => void.";
    // The entry imports the Child first, so it compiles before the Page fails.
    await writeFile(entry, 'import "./Child"; import "./Page";');
    await writeFile(page, "class Page {}");
    await writeFile(child, "class Child {}");
    const log = vi.fn();
    const outcomes = buildOutcomes({
      entry,
      folder: root,
      outdir: join(root, "out"),
      log,
    });
    try {
      await esbuild
        .build({
          absWorkingDir: root,
          entryPoints: [entry],
          bundle: true,
          write: false,
          logLevel: "silent",
          plugins: [
            models({
              compile: (path) => {
                if (path === entry) return null;
                if (path === child)
                  return { code: "\n\nexport {};", dependencies: [] };
                throw new PomCompileError([
                  {
                    text,
                    file,
                    line: 8,
                    column: 14,
                    lineText: "  async pick(callback: () => void) {",
                  },
                ]);
              },
              invalidate: () => {},
            }),
            outcomes.plugin,
          ],
        })
        .catch(() => {});
      const line = `${file}:8:14: ${text}`;
      expect(
        await failedPageObjects(entry, buildWith(outcomes.modules))
      ).toEqual({ entry, error: line, watching: true });
      expect(log).toHaveBeenCalledWith(
        `The Page Objects entry ${entry} did not build. No build of it has succeeded, so none is served.\n  ${line}`
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("omits generated positions when the working directory is a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "ayme-pom-link-"));
  const folder = join(root, "actual");
  const linked = join(root, ".ayme");
  await mkdir(folder);
  await symlink(folder, linked, "dir");
  await writeFile(join(folder, "Page.ts"), "class Page {}");
  try {
    const result = await esbuild
      .build({
        absWorkingDir: linked,
        entryPoints: ["Page.ts"],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [
          models({
            compile: () => ({
              code: '\n\nimport "./missing";',
              dependencies: [],
            }),
            invalidate: () => {},
          }),
        ],
      })
      .catch((error: esbuild.BuildFailure) => error);
    expect(result.errors).toMatchObject([
      {
        text: 'Could not resolve "./missing"',
        location: { file: "Page.ts", line: 0, column: 0 },
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports a tsconfig JSON error once, though the compiler and esbuild each read that tsconfig", async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-pom-tsconfig-"))
  );
  const tsconfig = join(folder, "tsconfig.json");
  await writeFile(
    tsconfig,
    '{\n  "compilerOptions": {\n    "target": "es2022",,\n  }\n}\n'
  );
  await writeFile(join(folder, "entry.ts"), "class Page {}\n");
  const log = vi.fn();
  const outcomes = buildOutcomes({
    entry: join(folder, "entry.ts"),
    folder,
    outdir: join(folder, "out"),
    log,
  });
  try {
    const failure = await esbuild
      .build({
        absWorkingDir: folder,
        entryPoints: ["entry.ts"],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [
          models({
            compile: () => {
              throw new PomCompileError([
                {
                  text: "Could not read TypeScript project configuration: Property assignment expected.",
                  file: tsconfig,
                  line: 3,
                  column: 24,
                  lineText: '    "target": "es2022",,',
                },
              ]);
            },
            invalidate: () => {},
          }),
          outcomes.plugin,
        ],
      })
      .catch((error: esbuild.BuildFailure) => error);
    // esbuild reads the tsconfig for `paths` and reports the mistake too.
    expect(failure.errors).toHaveLength(2);
    const error = (await outcomes
      .modules()
      .catch((e: unknown) => e)) as PageObjectsBuildError;
    expect(error.errors.map(buildErrorLine)).toEqual([
      `${tsconfig}:3:24: Could not read TypeScript project configuration: Property assignment expected.`,
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it("reports a tsconfig JSON error once when the tsconfig is a symlink, which esbuild names by its target", async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-pom-tsconfig-link-"))
  );
  const tsconfig = join(folder, "tsconfig.json");
  await mkdir(join(folder, "configs"));
  await writeFile(
    join(folder, "configs", "base.json"),
    '{\n  "compilerOptions": {\n    "target": "es2022",,\n  }\n}\n'
  );
  await symlink(join("configs", "base.json"), tsconfig);
  await writeFile(join(folder, "entry.ts"), "class Page {}\n");
  const outcomes = buildOutcomes({
    entry: join(folder, "entry.ts"),
    folder,
    outdir: join(folder, "out"),
    log: vi.fn(),
  });
  try {
    const failure = await esbuild
      .build({
        absWorkingDir: folder,
        entryPoints: ["entry.ts"],
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [
          models({
            compile: () => {
              throw new PomCompileError([
                {
                  text: "Could not read TypeScript project configuration: Property assignment expected.",
                  file: tsconfig,
                  line: 3,
                  column: 24,
                  lineText: '    "target": "es2022",,',
                },
              ]);
            },
            invalidate: () => {},
          }),
          outcomes.plugin,
        ],
      })
      .catch((error: esbuild.BuildFailure) => error);
    expect(failure.errors).toHaveLength(2);
    const error = (await outcomes
      .modules()
      .catch((e: unknown) => e)) as PageObjectsBuildError;
    expect(error.errors.map(buildErrorLine)).toEqual([
      `${tsconfig}:3:24: Could not read TypeScript project configuration: Property assignment expected.`,
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it("keeps esbuild's own error on the line of a compiler error when the file is not a tsconfig", async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-pom-same-line-"))
  );
  const other = join(folder, "other.js");
  await writeFile(other, 'import "./missing";\n');
  await writeFile(join(folder, "entry.ts"), "class Page {}\n");
  const outcomes = buildOutcomes({
    entry: join(folder, "entry.ts"),
    folder,
    outdir: join(folder, "out"),
    log: vi.fn(),
  });
  try {
    await esbuild
      .build({
        absWorkingDir: folder,
        entryPoints: ["entry.ts", "other.js"],
        bundle: true,
        write: false,
        outdir: join(folder, "out"),
        logLevel: "silent",
        plugins: [
          models({
            compile: () => {
              throw new PomCompileError([
                {
                  text: 'Page Object "Page" reaches two different classes named "Row".',
                  file: other,
                  line: 1,
                  column: 1,
                  lineText: 'import "./missing";',
                },
              ]);
            },
            invalidate: () => {},
          }),
          outcomes.plugin,
        ],
      })
      .catch((error: esbuild.BuildFailure) => error);
    const error = (await outcomes
      .modules()
      .catch((e: unknown) => e)) as PageObjectsBuildError;
    expect(error.errors.map(buildErrorLine).sort()).toEqual(
      [
        `${other}:1:1: Page Object "Page" reaches two different classes named "Row".`,
        `${other}:1:8: Could not resolve "./missing"`,
      ].sort()
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it("leaves an esbuild error without a location alone", () => {
  const { onEnd } = setUp(
    models({ compile: () => null, invalidate: () => {} })
  );
  const errors = [
    { text: "The service was stopped", location: null },
  ] as esbuild.Message[];
  onEnd({ errors });
  expect(errors).toEqual([{ text: "The service was stopped", location: null }]);
});

it.each(["entry", "helper"])(
  "keeps the source position of an uncompiled %s error",
  async (kind) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "ayme-pom-source-"))
    );
    const broken = 'export const first = 1;\nimport "./missing";';
    await writeFile(join(root, "Page.ts"), "class Page {}");
    await writeFile(
      join(root, "entry.ts"),
      kind === "entry" ? broken : 'import "./Page"; import "./helper";'
    );
    await writeFile(join(root, "helper.ts"), broken);
    try {
      const result = await esbuild
        .build({
          absWorkingDir: root,
          entryPoints: ["entry.ts"],
          bundle: true,
          write: false,
          logLevel: "silent",
          plugins: [
            models({
              compile: (file) =>
                file.endsWith("Page.ts")
                  ? { code: "console.log('compiled');", dependencies: [] }
                  : null,
              invalidate: () => {},
            }),
          ],
        })
        .catch((error: esbuild.BuildFailure) => error);
      expect(result.errors).toMatchObject([
        {
          text: 'Could not resolve "./missing"',
          location: {
            file: `${kind === "entry" ? "entry" : "helper"}.ts`,
            line: 2,
            column: 7,
          },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("invalidates and forgets compiled files on rebuild, retaining the last good build until a fix", async () => {
  const file = await realpath(await pomFile("// pom\nexport const value = 1;"));
  const folder = join(file, "..");
  const log = vi.fn();
  const invalidate = vi.fn();
  const outcomes = buildOutcomes({
    entry: file,
    folder,
    outdir: join(folder, "out"),
    log,
  });
  const context = await esbuild.context({
    absWorkingDir: folder,
    entryPoints: [file],
    outdir: join(folder, "out"),
    bundle: true,
    write: false,
    logLevel: "silent",
    format: "esm",
    plugins: [
      models({
        compile: (_file, source) =>
          source.startsWith("// pom")
            ? { code: `\n\n${source}`, dependencies: [] }
            : null,
        invalidate,
      }),
      outcomes.plugin,
    ],
  });
  try {
    await context.rebuild();
    const good = await outcomes.modules();
    expect([...good.values()].join("\n")).toContain("value = 1");
    await writeFile(file, '// pom\nimport "./missing";');
    await expect(context.rebuild()).rejects.toMatchObject({
      errors: [{ location: { line: 0, column: 0 } }],
    });
    expect(await outcomes.modules()).toBe(good);
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining("The page gets the last good build.")
    );
    // This file stops being a POM: the old compiled-file set must not hide its own position.
    await writeFile(file, 'import "./missing";');
    await expect(context.rebuild()).rejects.toMatchObject({
      errors: [{ location: { line: 1, column: 7 } }],
    });
    expect(await outcomes.modules()).toBe(good);
    await writeFile(file, "export const value = 2;");
    await context.rebuild();
    expect(
      [...(await outcomes.modules())].map(([, code]) => code).join("\n")
    ).toContain("value = 2");
    expect(await outcomes.modules()).not.toBe(good);
    expect(invalidate).toHaveBeenCalledTimes(4);
  } finally {
    await context.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

/**
 * A project folder, with a `package.json` and `files`, its Page Objects
 * entry, and an installed `@ayme-dev/ayme` of `version`, whose compiler
 * compiles nothing and records that it loaded, and whose runtime exports
 * `runtime`. A release from before the compiler entry has no `./compiler`.
 */
async function projectWithAyme(
  version: string,
  {
    files = [],
    compiler = true,
  }: { files?: readonly string[]; compiler?: boolean } = {}
) {
  const project = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-version-"))
  );
  const ayme = join(project, "node_modules", "@ayme-dev", "ayme");
  await mkdir(join(ayme, "dist"), { recursive: true });
  await writeFile(
    join(ayme, "package.json"),
    JSON.stringify({
      name: "@ayme-dev/ayme",
      version,
      type: "module",
      exports: {
        ".": "./dist/index.js",
        ...(compiler ? { "./compiler": "./dist/compiler.js" } : {}),
      },
    })
  );
  await writeFile(
    join(ayme, "dist", "index.js"),
    'export const runtime = "ayme";'
  );
  await writeFile(
    join(ayme, "dist", "compiler.js"),
    `globalThis.aymeCompilerLoaded = true;
export class PomCompileError extends Error {}
export const createPomCompiler = () => ({ compile: () => null, invalidate() {} });`
  );
  await writeFile(join(project, "package.json"), "{}");
  for (const file of files) await writeFile(join(project, file), "");
  const entry = join(project, ".ayme", "page-objects.ts");
  await mkdir(dirname(entry));
  await writeFile(entry, "export default [];");
  return { project, entry };
}

declare global {
  var aymeCompilerLoaded: boolean | undefined;
}

it("stops before it loads the compiler when the project's @ayme-dev/ayme is another version, naming both and the install command", async () => {
  const { project, entry } = await projectWithAyme("0.1.3", {
    files: ["pnpm-lock.yaml"],
  });
  globalThis.aymeCompilerLoaded = undefined;
  const started = watchPageObjects(entry, () => {}, "0.1.5");
  try {
    await expect(started).rejects.toThrow(
      `Building the Page Objects entry ${entry} stopped: this project has @ayme-dev/ayme 0.1.3; ayme mcp 0.1.5 needs the same version. Run \`pnpm add -D @ayme-dev/ayme@0.1.5\` in ${project}.`
    );
    expect(globalThis.aymeCompilerLoaded).toBeUndefined();
  } finally {
    await started.then(
      (build) => build.close(),
      () => {}
    );
    await rm(project, { recursive: true, force: true });
  }
});

it("names the versions, not a missing compiler, for a release from before the compiler entry, at a pnpm workspace's root", async () => {
  const { project, entry } = await projectWithAyme("0.1.3", {
    files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    compiler: false,
  });
  const started = watchPageObjects(entry, () => {}, "0.1.5");
  try {
    await expect(started).rejects.toThrow(
      `this project has @ayme-dev/ayme 0.1.3; ayme mcp 0.1.5 needs the same version. Run \`pnpm add -D -w @ayme-dev/ayme@0.1.5\` in ${project}.`
    );
  } finally {
    await started.then(
      (build) => build.close(),
      () => {}
    );
    await rm(project, { recursive: true, force: true });
  }
});

it("builds with the project's @ayme-dev/ayme when it is ayme mcp's version", async () => {
  const { project, entry } = await projectWithAyme("0.1.5");
  const log = vi.fn();
  const build = await watchPageObjects(entry, log, "0.1.5");
  try {
    const modules = await build.modules();
    expect([...modules.keys()]).toEqual(
      expect.arrayContaining(["entry.js", "runtime.js"])
    );
    expect([...modules.values()].join("\n")).toContain('"ayme"');
    expect(log).toHaveBeenCalledWith(`Built the Page Objects entry ${entry}.`);
  } finally {
    await build.close();
    await rm(project, { recursive: true, force: true });
  }
});
