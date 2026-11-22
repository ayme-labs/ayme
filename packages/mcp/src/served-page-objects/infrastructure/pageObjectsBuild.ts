import { existsSync, readFileSync, realpathSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import {
  aymeVersionMismatch,
  type PackageManager,
  type ProjectInstall,
} from "../domain/aymeVersion";
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

const COMPILER = "@ayme-dev/ayme/compiler";
const RUNTIME = "@ayme-dev/ayme";
/** The runtime entry's id, which no file on disk has. */
const RUNTIME_ENTRY = "ayme-served-runtime";
/** The plugin that compiles Page Object Models, which esbuild names on its errors. */
const MODELS_PLUGIN = "ayme-served-page-object-models";

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
 * Why the build of the Page Objects entry has not started, and the
 * project's install files whose change starts it again: none when they
 * could not be watched.
 */
export class PageObjectsNotStarted extends Error {
  constructor(
    message: string,
    readonly watched: readonly string[]
  ) {
    super(message);
  }
}

/** How long the install files stay unchanged before a start: an install writes them more than once. */
const SETTLED_MS = 100;

/**
 * The build of `entry`, started as {@link watchPageObjects} starts it. When
 * it cannot start, for instance while the project's `@ayme-dev/ayme` is
 * another version than `version` or does not resolve, it logs why and
 * starts it again: when the project's `package.json` or nearest lockfile
 * changes (`watch` watches them), and when `modules()` is asked and the
 * project's `@ayme-dev/ayme` no longer is what the last start found. Until
 * it starts, `modules()` rejects with a {@link PageObjectsNotStarted}, and
 * `onBuilt` listeners hear the builds of the build that starts.
 */
export async function startPageObjects(
  entry: string,
  log: (message: string) => void,
  version: string,
  watch: typeof watchFiles = watchFiles
): Promise<PageObjectsBuild> {
  const folder = dirname(entry);
  const listeners = new Set<(modules: BuiltModules) => void>();
  let lastHeard: BuiltModules | undefined;
  const hear = (modules: BuiltModules) => {
    if (modules === lastHeard) return;
    lastHeard = modules;
    for (const listener of listeners) listener(modules);
  };
  const problemNow = async () => {
    const found = await projectAyme(entry, version);
    return "problem" in found ? found.problem : undefined;
  };
  let started: PageObjectsBuild | undefined;
  /**
   * Why the last start failed, what was wrong with the project's
   * `@ayme-dev/ayme` then, and the install files watched since.
   */
  let failure:
    | { message: string; problem: string | undefined; watched: string[] }
    | undefined;
  let stopWatching = () => {};
  let closed = false;
  let attempt: Promise<void> | undefined;
  let settling: NodeJS.Timeout | undefined;
  // A change during an attempt starts another once it ends.
  let changedMeanwhile = false;
  const tryStart = async () => {
    let problem: string | undefined;
    try {
      problem = await problemNow();
      const build = await watchPageObjects(entry, log, version);
      if (closed) return void (await build.close());
      stopWatching();
      started = build;
      failure = undefined;
      build.onBuilt(hear);
      build.modules().then(hear, () => {});
    } catch (error) {
      const message = (error as Error).message;
      log(message);
      stopWatching();
      const watched: string[] = [];
      if (!closed)
        try {
          // A file watched before stays watched, so that a lockfile an
          // install removes is watched when it writes it again.
          for (const file of [
            ...(failure?.watched ?? []),
            ...installFiles(folder),
          ])
            if (!watched.includes(file)) watched.push(file);
          stopWatching = watch(
            watched,
            () => {
              clearTimeout(settling);
              settling = setTimeout(retry, SETTLED_MS);
            },
            () => (watched.length = 0)
          );
        } catch {
          watched.length = 0;
        }
      failure = { message, problem, watched };
    }
  };
  const retry = () => {
    if (started !== undefined || closed) return;
    if (attempt !== undefined) return void (changedMeanwhile = true);
    attempt = tryStart().finally(() => {
      attempt = undefined;
      if (changedMeanwhile) {
        changedMeanwhile = false;
        retry();
      }
    });
  };
  const attempted = async () => {
    while (attempt !== undefined) await attempt;
  };
  retry();
  await attempted();
  return {
    async modules() {
      await attempted();
      if (
        started === undefined &&
        !closed &&
        (await problemNow()) !== failure!.problem
      ) {
        retry();
        await attempted();
      }
      if (started !== undefined) return started.modules();
      throw new PageObjectsNotStarted(failure!.message, failure!.watched);
    },
    onBuilt(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async close() {
      closed = true;
      clearTimeout(settling);
      stopWatching();
      await attempted();
      await started?.close();
    },
  };
}

/**
 * Calls `changed` whenever one of `files` is written, created or removed,
 * and `failed` if watching stops on its own; returns how to stop. Watches
 * each file's folder, so a file that does not exist yet is watched too.
 */
export function watchFiles(
  files: readonly string[],
  changed: () => void,
  failed: () => void = () => {}
): () => void {
  const names = new Map<string, Set<string>>();
  for (const file of files)
    names.set(
      dirname(file),
      (names.get(dirname(file)) ?? new Set()).add(basename(file))
    );
  const watchers: ReturnType<typeof watch>[] = [];
  const stop = () => watchers.forEach((watcher) => watcher.close());
  try {
    for (const [folder, inFolder] of names) {
      const watcher = watch(folder, (_event, name) => {
        if (name === null || inFolder.has(String(name))) changed();
      });
      // A watched folder that goes away stops the watching, not the server.
      watcher.on("error", () => {
        stop();
        failed();
      });
      watchers.push(watcher);
    }
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/**
 * The project's `package.json`, for the project `folder` is in, and the
 * nearest lockfile above it, if any: the files an install changes.
 */
function installFiles(folder: string): string[] {
  const { folder: projectFolder } = projectInstall(folder);
  const lockfile = nearestLockfile(projectFolder);
  return [
    join(projectFolder, "package.json"),
    ...(lockfile === undefined ? [] : [join(lockfile.folder, lockfile.name)]),
  ];
}

/**
 * Builds `entry` for the browser, with esbuild and the Page Object compiler
 * of `@ayme-dev/ayme`, as minified ES modules split into chunks: `entry.js`,
 * whose default export is the entry's, and `runtime.js`, which re-exports
 * `@ayme-dev/ayme`; both share one copy of the runtime. What the runtime
 * imports lazily, such as the Inspector and the screenshot renderer, stays
 * in chunks of its own, which a page fetches on first use. Every import,
 * the runtime's and the compiler's included, resolves from the entry's
 * folder, as in a build of the project itself, so the page runs, and its
 * Page Objects are compiled by, the project's own `@ayme-dev/ayme`. It
 * starts only when that is version `version`, `ayme mcp`'s own: it rejects
 * with why otherwise, before it loads the compiler.
 *
 * It builds again whenever a file the build read changes, in watch mode,
 * and logs each outcome. A build that fails is logged with each error's
 * file, and leaves the last good build served.
 */
export async function watchPageObjects(
  entry: string,
  log: (message: string) => void,
  version: string
): Promise<PageObjectsBuild> {
  const folder = dirname(entry);
  const found = await projectAyme(entry, version);
  if ("problem" in found) throw new Error(found.problem);
  const { createPomCompiler, PomCompileError } =
    await importFile<PomCompilerEntry>(found.compiler);
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
            errors: withoutRepeats(errors, folder).map(
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
            ),
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

/**
 * Why `build` serves nothing while no build of `entry` has succeeded: the
 * first error of the last build, or why the build could not start, and
 * whether it watches the entry's files, which it does once started, or the
 * project's install files, which it does while it could not start. It
 * waits for the first build to end, and resolves with `undefined` once a
 * build has succeeded.
 */
export async function failedPageObjects(
  entry: string,
  build: Promise<PageObjectsBuild>
): Promise<
  | {
      entry: string;
      error: string;
      watching: boolean;
      installFiles?: readonly string[];
    }
  | undefined
> {
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
    if (error instanceof PageObjectsNotStarted)
      return {
        entry,
        error: error.message,
        watching: error.watched.length > 0,
        ...(error.watched.length > 0 ? { installFiles: error.watched } : {}),
      };
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

/**
 * The compiler entry of the project's `@ayme-dev/ayme`, resolved from the
 * folder of `entry`, or why it does not build `entry`: it does not
 * resolve, or it is not version `version`. Its version is read through the
 * main entry, which every release exports, so that a release without the
 * compiler entry gets the same answer. Both are resolved afresh on each
 * call, unlike Node's resolver, which keeps what it resolved for the life
 * of the process, so a call after an install finds what it installed.
 */
async function projectAyme(
  entry: string,
  version: string
): Promise<{ compiler: string } | { problem: string }> {
  const folder = dirname(entry);
  const resolved = await resolveAfresh(folder, [RUNTIME, COMPILER]);
  const doesNotResolve = (specifier: string) => ({
    problem: `Building the Page Objects entry ${entry} needs ${specifier}, which does not resolve from ${folder}.`,
  });
  const runtime = resolved.get(RUNTIME);
  if (runtime === undefined) return doesNotResolve(RUNTIME);
  const mismatch = aymeVersionMismatch({
    entry,
    project: packageVersion(runtime, RUNTIME),
    mcp: version,
    install: projectInstall(folder),
  });
  if (mismatch !== undefined) return { problem: mismatch };
  const compiler = resolved.get(COMPILER);
  return compiler === undefined ? doesNotResolve(COMPILER) : { compiler };
}

/** Each of `specifiers` that resolves from `folder` as an import, by esbuild, which keeps nothing between builds. */
async function resolveAfresh(
  folder: string,
  specifiers: readonly string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const probe = Symbol("resolving");
  await esbuild.build({
    stdin: {
      contents: specifiers
        .map((s) => `import ${JSON.stringify(s)};`)
        .join("\n"),
      resolveDir: folder,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "ayme-resolve-afresh",
        setup(build) {
          build.onResolve({ filter: /.*/ }, async ({ path, pluginData }) => {
            if (pluginData === probe || !specifiers.includes(path)) return;
            const result = await build.resolve(path, {
              kind: "import-statement",
              resolveDir: folder,
              pluginData: probe,
            });
            if (result.errors.length === 0) resolved.set(path, result.path);
            return { path, external: true };
          });
        },
      },
    ],
  });
  return resolved;
}

/**
 * The version of the package `name` that `file` belongs to, read from the
 * nearest `package.json` above it with that name, or `undefined` if none.
 */
function packageVersion(file: string, name: string): string | undefined {
  for (let folder = dirname(file); ; folder = dirname(folder)) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(folder, "package.json"), "utf8")
      ) as { name?: unknown; version?: unknown };
      if (manifest.name === name && typeof manifest.version === "string")
        return manifest.version;
    } catch {
      // No package.json here, or not one that parses: look further up.
    }
    if (dirname(folder) === folder) return undefined;
  }
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/**
 * Where and how to install a package for the project `folder` is in: the
 * nearest folder above it with a `package.json` (`folder` itself if none),
 * the package manager of the lockfile nearest above that (npm if none), and
 * whether that folder is a pnpm workspace's root.
 */
function projectInstall(folder: string): ProjectInstall {
  const project = nearestAbove(folder, (current) =>
    existsSync(join(current, "package.json"))
  );
  const projectFolder = project ?? folder;
  return {
    packageManager: nearestLockfile(projectFolder)?.packageManager ?? "npm",
    folder: projectFolder,
    workspaceRoot: existsSync(join(projectFolder, "pnpm-workspace.yaml")),
  };
}

/** The lockfile nearest above `folder`, from `folder` itself up, if any. */
function nearestLockfile(folder: string) {
  for (let current = folder; ; current = dirname(current)) {
    const found = LOCKFILES.find(([name]) => existsSync(join(current, name)));
    if (found !== undefined)
      return { folder: current, name: found[0], packageManager: found[1] };
    if (dirname(current) === current) return undefined;
  }
}

/** The nearest folder from `folder` up for which `found` holds, if any. */
function nearestAbove(
  folder: string,
  found: (folder: string) => boolean
): string | undefined {
  for (let current = folder; ; current = dirname(current)) {
    if (found(current)) return current;
    if (dirname(current) === current) return undefined;
  }
}

async function importFile<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(file).href)) as T;
}
