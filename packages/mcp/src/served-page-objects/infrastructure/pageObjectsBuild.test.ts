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
  let onLoad!: (args: { path: string }) => Promise<unknown>;
  let onEnd!: (result: Partial<esbuild.BuildResult>) => void;
  void plugin.setup({
    onStart: () => {},
    onLoad: (_options: unknown, callback: typeof onLoad) => (onLoad = callback),
    onEnd: (callback: typeof onEnd) => (onEnd = callback),
  } as unknown as esbuild.PluginBuild);
  return { onLoad, onEnd };
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
it.each([
  'const before = 1;\nimport { nope } from "./does-not-exist";\nnope();',
  'const é = "😀"; import { nope } from "./does-not-exist"; nope();',
])(
  "omits generated positions for an unresolved import in %s",
  async (source) => {
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
      expect(
        await failedPageObjects(file, buildWith(outcomes.modules))
      ).toEqual({
        entry: file,
        error: `${file}: Could not resolve "./does-not-exist"`,
        watching: true,
      });
    } finally {
      await rm(join(file, ".."), { recursive: true, force: true });
    }
  }
);

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
