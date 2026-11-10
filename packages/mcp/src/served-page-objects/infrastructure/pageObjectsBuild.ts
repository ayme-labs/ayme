import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { buildFailure } from "../domain/buildFailure";
import { ENTRY_MODULE, RUNTIME_MODULE } from "../domain/servedPageObjects";

/** The built modules, by their path under the served path. */
export type BuiltModules = ReadonlyMap<string, string>;

/** What `ayme mcp` uses of the Page Object compiler of `@ayme-dev/ayme/compiler`. */
type PomCompilerEntry = {
  createPomCompiler(options: { include: boolean }): {
    compile(
      fileName: string,
      source: string,
      options: { emit: "js" }
    ): { code: string; dependencies: readonly string[] } | null;
    invalidate(): void;
  };
};

const COMPILER = "@ayme-dev/ayme/compiler";
const RUNTIME = "@ayme-dev/ayme";
/** The runtime entry's id, which no file on disk has. */
const RUNTIME_ENTRY = "ayme-served-runtime";

/** The Page Objects entry's build, which rebuilds as its files change. */
export type PageObjectsBuild = {
  /**
   * The last good build. Before the first build ends, it waits for it;
   * while no build has succeeded, it rejects with why the last one failed.
   */
  modules(): Promise<BuiltModules>;
  /** Calls `listener` with each good build from now on; returns how to stop. */
  onBuilt(listener: (modules: BuiltModules) => void): () => void;
  /** Stops watching. */
  close(): Promise<void>;
};

/**
 * Builds `entry` for the browser, with esbuild and the Page Object compiler
 * of `@ayme-dev/ayme`, as minified ES modules split into chunks: `entry.js`,
 * whose default export is the entry's, and `runtime.js`, which re-exports
 * `@ayme-dev/ayme`; both share one copy of the runtime. What the runtime
 * imports lazily, such as the Inspector and the screenshot renderer, stays
 * in chunks of its own, which a page fetches on first use. Every import,
 * the runtime's and the compiler's included, resolves from the entry's
 * folder, as in a build of the project itself, so the page runs, and its
 * Page Objects are compiled by, the project's own `@ayme-dev/ayme`.
 *
 * It builds again whenever a file the build read changes, in watch mode,
 * and logs each outcome. A build that fails is logged with each error's
 * file, and leaves the last good build served.
 */
export async function watchPageObjects(
  entry: string,
  log: (message: string) => void
): Promise<PageObjectsBuild> {
  const folder = dirname(entry);
  const { createPomCompiler } = await importFile<PomCompilerEntry>(
    resolveFrom(folder, COMPILER, entry)
  );
  // Nothing is written there: the outputs stay in memory.
  const outdir = join(folder, "ayme-served");
  const outcomes = buildOutcomes({ entry, folder, outdir, log });
  const context = await esbuild.context({
    absWorkingDir: folder,
    entryPoints: {
      [RUNTIME_MODULE.replace(/\.js$/, "")]: RUNTIME_ENTRY,
      [ENTRY_MODULE.replace(/\.js$/, "")]: entry,
    },
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    platform: "browser",
    write: false,
    outdir,
    logLevel: "silent",
    plugins: [
      runtimeEntry(folder),
      pageObjectModels(createPomCompiler({ include: true })),
      outcomes.plugin,
    ],
  });
  await context.watch();
  return {
    modules: outcomes.modules,
    onBuilt: outcomes.onBuilt,
    close: () => context.dispose(),
  };
}

/**
 * Compiles each Page Object Model the build reaches, outside
 * `node_modules`, with the project's own compiler; every other module
 * builds as esbuild builds it.
 */
function pageObjectModels(
  compiler: ReturnType<PomCompilerEntry["createPomCompiler"]>
): esbuild.Plugin {
  return {
    name: "ayme-served-page-object-models",
    setup(build) {
      // A rebuild compiles afresh, so an edited dependency reaches the manifest.
      build.onStart(() => compiler.invalidate());
      build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        if (path.split(sep).includes("node_modules")) return;
        const pom = compiler.compile(path, await readFile(path, "utf8"), {
          emit: "js",
        });
        if (pom === null) return;
        return {
          contents: pom.code,
          loader: "js",
          // esbuild watches a module a plugin loads only through the files
          // the plugin names, the module's own file included.
          watchFiles: [path, ...pom.dependencies],
        };
      });
    },
  };
}

/**
 * Keeps the last good build and logs each build's outcome, from the end of
 * every build.
 */
function buildOutcomes({
  entry,
  folder,
  outdir,
  log,
}: {
  entry: string;
  folder: string;
  outdir: string;
  log: (message: string) => void;
}) {
  let good: BuiltModules | undefined;
  let failure: Error | undefined;
  let firstEnded: () => void;
  const first = new Promise<void>((resolve) => (firstEnded = resolve));
  let built = 0;
  const listeners = new Set<(modules: BuiltModules) => void>();
  const plugin: esbuild.Plugin = {
    name: "ayme-served-outcomes",
    setup(build) {
      build.onEnd(({ errors, outputFiles = [] }) => {
        if (errors.length === 0) {
          good = new Map(
            outputFiles.map((file) => [
              relative(outdir, file.path).split("\\").join("/"),
              file.text,
            ])
          );
          failure = undefined;
          log(
            `${built++ === 0 ? "Built" : "Rebuilt"} the Page Objects entry ${entry}.`
          );
          for (const listener of listeners) listener(good);
        } else {
          failure = new Error(
            buildFailure({
              entry,
              lastGood: good !== undefined,
              errors: errors.map(({ text, location }) => ({
                text,
                location: location && {
                  file: resolve(folder, location.file),
                  line: location.line,
                  column: location.column,
                },
              })),
            })
          );
          log(failure.message);
        }
        firstEnded();
      });
    },
  };
  return {
    plugin,
    async modules() {
      await first;
      if (good !== undefined) return good;
      throw failure!;
    },
    onBuilt(listener: (modules: BuiltModules) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The runtime's entry: a module that re-exports `@ayme-dev/ayme` from `folder`. */
function runtimeEntry(folder: string): esbuild.Plugin {
  const namespace = "ayme-served";
  return {
    name: "ayme-served-runtime",
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${RUNTIME_ENTRY}$`) }, () => ({
        path: RUNTIME_ENTRY,
        namespace,
      }));
      build.onLoad({ filter: /.*/, namespace }, () => ({
        contents: `export * from ${JSON.stringify(RUNTIME)};`,
        resolveDir: folder,
        loader: "js",
      }));
    },
  };
}

function resolveFrom(folder: string, specifier: string, entry: string) {
  try {
    return createRequire(join(folder, "index.js")).resolve(specifier);
  } catch {
    throw new Error(
      `Building the Page Objects entry ${entry} needs ${specifier}, which does not resolve from ${folder}.`
    );
  }
}

async function importFile<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(file).href)) as T;
}
