import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import * as esbuild from "esbuild";

import type { BuildError } from "../domain/buildFailure";
import type { BuiltModules } from "../domain/buildState";
import {
  ENTRY_MODULE,
  RUNTIME_MODULE,
  RUNTIME_PACKAGE,
} from "../domain/servedPageObjects";

export type PageObjectsBuildEvent =
  | { kind: "building" }
  | { kind: "built"; modules: BuiltModules }
  | { kind: "failed"; errors: readonly BuildError[] };

/** What `ayme mcp` uses of the Page Object compiler of `@ayme-dev/ayme/compiler`. */
export type PomCompilerEntry = {
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
 * fault and the 1-based line and column in it as written, with that line's
 * text, where it knows them.
 */
type PomDiagnostic =
  | { text: string; file?: undefined }
  | { text: string; file: string; line?: undefined }
  | {
      text: string;
      file: string;
      line: number;
      /** Counted in UTF-16 code units of `lineText`. */
      column: number;
      /** The line as written, without its line break. */
      lineText: string;
    };

/** The runtime entry's id, which no file on disk has. */
const RUNTIME_ENTRY = "ayme-served-runtime";
/** The plugin that compiles Page Object Models, which esbuild names on its errors. */
const MODELS_PLUGIN = "ayme-served-page-object-models";

/**
 * Builds `entry` for the browser, with esbuild and the Page Object compiler
 * of `@ayme-dev/ayme`, as minified ES modules split into chunks: `entry.js`,
 * whose default export is the entry's, and `runtime.js`, which re-exports
 * `@ayme-dev/ayme`; both share one copy of the runtime. What the runtime
 * imports lazily, such as the Inspector and the screenshot renderer, stays
 * in chunks of its own, which a page fetches on first use. Every import,
 * including the runtime, resolves from the entry's folder so the browser
 * runs the project's own runtime. Page Object Models use the supplied compiler.
 */
export async function watchPageObjects(
  entry: string,
  { createPomCompiler, PomCompileError }: PomCompilerEntry,
  publish: (event: PageObjectsBuildEvent) => void
): Promise<() => Promise<void>> {
  const folder = dirname(entry);
  // Nothing is written there: the outputs stay in memory.
  const outdir = join(folder, "ayme-served");
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
      buildResults(folder, outdir, publish),
    ],
  });
  try {
    await context.watch();
    return () => context.dispose();
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

/**
 * Compiles each Page Object Model the build reaches, outside
 * `node_modules`, with the project's own compiler; every other module
 * builds as esbuild builds it. A compile error is reported at each place
 * the compiler names, or at the module it compiled when it names none.
 */
function pageObjectModels(
  compiler: ReturnType<PomCompilerEntry["createPomCompiler"]>,
  PomCompileError: PomCompilerEntry["PomCompileError"]
): esbuild.Plugin {
  const compiled = new Set<string>();
  return {
    name: MODELS_PLUGIN,
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
            error.pluginName !== MODELS_PLUGIN &&
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
  const { file, line, column, lineText } = diagnostic;
  return {
    text,
    location: {
      file,
      line,
      // TypeScript counts the column from 1 in UTF-16 code units; esbuild
      // counts it from 0 in UTF-8 bytes.
      column: Buffer.byteLength(lineText.slice(0, column - 1)),
      // esbuild draws its code frame from this line, which it has not loaded.
      lineText,
    },
  };
}

function buildResults(
  folder: string,
  outdir: string,
  publish: (event: PageObjectsBuildEvent) => void
): esbuild.Plugin {
  return {
    name: "ayme-served-outcomes",
    setup(build) {
      build.onStart(() => publish({ kind: "building" }));
      build.onEnd(({ errors, outputFiles = [] }) => {
        if (errors.length === 0) {
          const modules = new Map(
            outputFiles.map((file) => [
              relative(outdir, file.path).split("\\").join("/"),
              file.text,
            ])
          );
          publish({ kind: "built", modules });
        } else {
          const diagnostics = withoutRepeats(errors, folder).map(
            ({ text, location, pluginName }) => {
              if (!location) return { text, location };
              const file = resolve(folder, location.file);
              return {
                text,
                location: {
                  file,
                  line: location.line,
                  column:
                    // A plugin's error has the column the plugin gave it.
                    pluginName || location.line !== 1
                      ? location.column
                      : location.column - byteOrderMarkLength(file),
                  lineText: location.lineText,
                },
              };
            }
          );
          publish({ kind: "failed", errors: diagnostics });
        }
      });
    },
  };
}

/**
 * `errors` without esbuild's own errors at a line of a JSON file where the
 * compiler reports one. esbuild reads the tsconfig a compile reads, for its
 * `paths`, so a mistake in it would be listed by both. Only a tsconfig is
 * JSON that both read: in any other file, two errors on a line are two
 * mistakes. esbuild names a symlinked tsconfig by its target, so files are
 * compared by their real paths, in `folder`.
 */
function withoutRepeats(errors: readonly esbuild.Message[], folder: string) {
  const jsonLine = ({ location }: esbuild.Message) =>
    location?.file.endsWith(".json")
      ? `${realPath(resolve(folder, location.file))}:${location.line}`
      : undefined;
  const compilerLines = new Set(
    errors.filter((error) => error.pluginName === MODELS_PLUGIN).map(jsonLine)
  );
  return errors.filter((error) => {
    if (error.pluginName) return true;
    const line = jsonLine(error);
    return line === undefined || !compilerLines.has(line);
  });
}

/** The real path of `file`, or `file` itself when it cannot be resolved. */
function realPath(file: string) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * The bytes of the byte order mark `file` starts with, or 0. esbuild counts
 * them in a column on the file's first line and leaves the mark out of the
 * line's text; TypeScript and editors count neither.
 */
function byteOrderMarkLength(file: string): number {
  try {
    return readFileSync(file).subarray(0, 3).equals(BYTE_ORDER_MARK) ? 3 : 0;
  } catch {
    return 0;
  }
}

const BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

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
        contents: `export * from ${JSON.stringify(RUNTIME_PACKAGE)};`,
        resolveDir: folder,
        loader: "js",
      }));
    },
  };
}
