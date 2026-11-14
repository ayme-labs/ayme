import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as esbuild from "esbuild";
import { expect, it, vi } from "vitest";

import { PageObjectsBuildError } from "../domain/buildFailure";
import {
  buildOutcomes,
  failedPageObjects,
  pageObjectModels,
  type PageObjectsBuild,
} from "./pageObjectsBuild";

const entry = "/project/.ayme/page-objects.ts";

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
    error: "/project/.ayme/pom/PlainPage.ts:22:0: Unexpected end of file",
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
  const { onLoad } = setUp(pageObjectModels({ compile, invalidate: () => {} }));

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

it("reports a compiler error against the file it compiled, and keeps watching it and what the compile read", async () => {
  const file = await pomFile("class Page {}");
  const { onLoad } = setUp(
    pageObjectModels({
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

it("leaves to esbuild a module the compiler does not compile, and one in node_modules", async () => {
  const compile = vi.fn(() => null);
  const { onLoad } = setUp(pageObjectModels({ compile, invalidate: () => {} }));

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
    pageObjectModels({
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
          pageObjectModels({
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

it("keeps a compiler error's original child file and parameter position", async () => {
  const file = await pomFile("class Page {}");
  const text =
    "/project/Child.ts:8:14: Unsupported Page Object Tool input type for Child.pick(callback): () => void.";
  const { onLoad } = setUp(
    pageObjectModels({
      compile: () => {
        throw new Error(text);
      },
      invalidate: () => {},
    })
  );
  expect(await onLoad({ path: file })).toMatchObject({
    errors: [{ text, location: null }],
  });
});

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
          pageObjectModels({
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

it.each([
  ["/project/Child.ts:108:214: unsupported", true],
  ["C:\\project\\Child.ts:1:2: unsupported", true],
  [":1:2: no file", false],
  ["/project/Child.ts::2: no line", false],
  ["/project/Child.ts:1:: no column", false],
  ["/project/Child.ts:x:2: nonnumeric line", false],
  ["/project/Child.ts:1:y: nonnumeric column", false],
  ["/project/Child.ts:1:2:no separator space", false],
  ["wrapper\n/project/Child.ts:1:2: nested diagnostic", false],
])(
  "keeps a file prefix only for an unlocated compiler error: %s",
  async (text, located) => {
    const file = await pomFile("class Page {}");
    try {
      const { onLoad } = setUp(
        pageObjectModels({
          compile: () => {
            throw new Error(text);
          },
          invalidate: () => {},
        })
      );
      expect(await onLoad({ path: file })).toMatchObject({
        errors: [{ text, location: located ? null : { file } }],
      });
    } finally {
      await rm(join(file, ".."), { recursive: true, force: true });
    }
  }
);

it("leaves an esbuild error without a location alone", () => {
  const { onEnd } = setUp(
    pageObjectModels({ compile: () => null, invalidate: () => {} })
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
            pageObjectModels({
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
      pageObjectModels({
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
