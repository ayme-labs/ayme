import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { PageObjectsBuildError, buildErrorLine } from "../domain/buildFailure";
import { ENTRY_MODULE, RUNTIME_MODULE } from "../domain/servedPageObjects";

/** The built modules, by their path under the served path. */
export type BuiltModules = ReadonlyMap<string, string>;

/** What `ayme mcp` uses of the Page Object compiler of `@ayme-dev/ayme/compiler`. */
type PomCompilerEntry = {
  createPomCompiler(options: { include: boolean }): {
    compile(
      fileName: string,
      source: string,
      options: {
        emit: "js";
        onDependencies?: (dependencies: readonly string[]) => void;
      }
    ): { code: string; dependencies: readonly string[] } | null;
    invalidate(): void;
  };
  /** What `compile` throws when the module's source, an import or its tsconfig is at fault. */
  PomCompileError: new (...args: never[]) => Error & {
    readonly diagnostics: readonly PomDiagnostic[];
  };
};

/**
 * One reason a module did not compile, as the compiler states it: the file at
 * fault and the 1-based line and column in it as written, where it knows them.
 */
type PomDiagnostic =
  | { text: string; file?: undefined }
  | { text: string; file: string; line?: undefined }
  | { text: string; file: string; line: number; column: number };

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
  const { createPomCompiler, PomCompileError } =
    await importFile<PomCompilerEntry>(resolveFrom(folder, COMPILER, entry));
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
      pageObjectModels(createPomCompiler({ include: true }), PomCompileError),
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
 * builds as esbuild builds it. A compile error is reported at each place
 * the compiler names, or at the module it compiled when it names none.
 */
export function pageObjectModels(
  compiler: ReturnType<PomCompilerEntry["createPomCompiler"]>,
  PomCompileError: PomCompilerEntry["PomCompileError"]
): esbuild.Plugin {
  const compiled = new Set<string>();
  const name = "ayme-served-page-object-models";
  return {
    name,
    setup(build) {
      // A rebuild compiles afresh, so an edited dependency reaches the manifest.
      build.onStart(() => {
        compiled.clear();
        compiler.invalidate();
      });
      build.onEnd(({ errors }) => {
        for (const error of errors) {
          const location = error.location;
          if (
            // The compiler's own errors are at positions in the source.
            error.pluginName !== name &&
            location &&
            compiled.has(
              resolve(
                realpathSync(
                  build.initialOptions.absWorkingDir ?? process.cwd()
                ),
                location.file
              )
            )
          ) {
            // The compiler returns no source map: generated coordinates name no source position.
            error.location = { ...location, line: 0, column: 0 };
          }
        }
      });
      build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        if (path.split(sep).includes("node_modules")) return;
        // What the compile read before it threw, such as a tsconfig.json.
        let read: readonly string[] = [];
        let pom;
        try {
          pom = compiler.compile(path, await readFile(path, "utf8"), {
            emit: "js",
            onDependencies: (dependencies) => (read = dependencies),
          });
        } catch (error) {
          // Thrown, it would point at esbuild's own code, not at the file.
          return {
            errors:
              error instanceof PomCompileError
                ? error.diagnostics.map((diagnostic) =>
                    buildError(diagnostic, path)
                  )
                : [
                    {
                      text: (error as Error).message,
                      location: { file: path },
                    },
                  ],
            watchFiles: [path, ...read],
          };
        }
        if (pom === null) return;
        compiled.add(path);
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
 * `diagnostic` as an esbuild error. Without a file it is at `compiled`, the
 * module whose compile failed: esbuild would put an error without a location
 * at the import of that module.
 */
function buildError(
  diagnostic: PomDiagnostic,
  compiled: string
): esbuild.PartialMessage {
  const { text } = diagnostic;
  if (diagnostic.file === undefined)
    return { text, location: { file: compiled } };
  if (diagnostic.line === undefined)
    return { text, location: { file: diagnostic.file } };
  const { file, line, column } = diagnostic;
  return {
    text,
    location: { file, line, column: esbuildColumn(file, line, column) },
  };
}

/**
 * `column` of `line` in `file`, counted from 1 in UTF-16 code units as
 * TypeScript counts it, as esbuild counts it: from 0, in UTF-8 bytes. Without
 * that line, the count of code units stands in.
 */
function esbuildColumn(file: string, line: number, column: number) {
  const lineText = sourceLine(file, line);
  return lineText === undefined
    ? column - 1
    : Buffer.byteLength(lineText.slice(0, column - 1));
}

/** Line `line` of `file`, counted from 1, if the file can be read and has it. */
function sourceLine(file: string, line: number): string | undefined {
  try {
    // TypeScript's line breaks, so the line is the one it counted.
    return readFileSync(file, "utf8").split(/\r\n|[\n\r\u2028\u2029]/)[
      line - 1
    ];
  } catch {
    // An unreadable file has no line to measure.
  }
  return undefined;
}

/**
 * Keeps the last good build and logs each build's outcome, from the end of
 * every build.
 */
export function buildOutcomes({
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
          failure = new PageObjectsBuildError({
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
          });
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

/**
 * Why `build` serves nothing while no build of `entry` has succeeded: the
 * first error of the last build, or why the build could not start, and
 * whether it watches the entry's files, which it does once started. It
 * waits for the first build to end, and resolves with `undefined` once a
 * build has succeeded.
 */
export async function failedPageObjects(
  entry: string,
  build: Promise<PageObjectsBuild>
): Promise<{ entry: string; error: string; watching: boolean } | undefined> {
  let started: PageObjectsBuild;
  try {
    started = await build;
  } catch (error) {
    return { entry, error: (error as Error).message, watching: false };
  }
  try {
    await started.modules();
    return undefined;
  } catch (error) {
    return {
      entry,
      error:
        error instanceof PageObjectsBuildError && error.errors[0]
          ? buildErrorLine(error.errors[0])
          : (error as Error).message,
      watching: true,
    };
  }
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
