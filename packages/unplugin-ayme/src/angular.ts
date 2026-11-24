import { createHash } from "node:crypto";
import {
  mkdirSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PartialMessage, Plugin } from "esbuild";

import {
  createPomCompiler,
  PomCompileError,
  type PomDiagnostic,
} from "@ayme-dev/ayme/compiler";

export type AymeAngularOptions = {
  /**
   * The tsconfig ayme's compiler reads, resolved from the workspace root.
   * Point it at the app's own tsconfig, which Angular's watcher also reads.
   */
  tsconfigPath?: string;
  /**
   * Whether the build includes ayme. Defaults to false: the runtime's
   * entries then resolve to its absent entry and each Page Object Model
   * compiles to a stand-in.
   */
  include?: boolean;
};

const namespace = "ayme-pom";
const suffix = "?ayme-pom";

type CompiledPom = { contents: string; watchFiles: readonly string[] };

/**
 * What a module with files Angular ignores imports. The plugin resolves it to
 * the signal file, so the module's text names no path of this machine.
 */
const signalSpecifier = "ayme-angular:rebuild-signal";
/** How often the plugin looks at the files Angular's watcher leaves out. */
const hiddenFilePollMs = 250;
/**
 * How long Angular gets to start a rebuild by itself after an edit, which its
 * default watcher does from 22.2 on.
 */
const ownRebuildMs = 750;

/**
 * esbuild code plugin for Angular's application builder, which consumers
 * reach through `@angular-builders/custom-esbuild`.
 */
export function aymeAngular(options: AymeAngularOptions = {}): Plugin {
  const unknown = Object.keys(options).filter(
    (key) => key !== "tsconfigPath" && key !== "include"
  );
  if (unknown.length > 0)
    throw new TypeError(
      `ayme's Angular plugin has no option(s): ${unknown.join(", ")}. Referenced in angular.json as a plain string, it receives the builder's options.`
    );
  if (
    options.tsconfigPath !== undefined &&
    typeof options.tsconfigPath !== "string"
  )
    throw new TypeError("tsconfigPath must be a string");
  // Checks include where the options are taken, before any build.
  const { includeLine } = createPomCompiler({ include: options.include });
  const include = options.include === true;
  return {
    name: "ayme-angular",
    setup(build) {
      // Server bundles keep Angular's emit: SSR never constructs Page Objects.
      if (build.initialOptions.platform === "node") return;
      const root = build.initialOptions.absWorkingDir ?? process.cwd();
      // One Program per tsconfig project and build (ADR-0036).
      const compiler = createPomCompiler({
        tsconfigPath:
          options.tsconfigPath && path.resolve(root, options.tsconfigPath),
        include: options.include,
      });
      // One compilation per module and build; a rebuild starts afresh so an
      // edited dependency reaches the manifest.
      let compiled = new Map<string, Promise<CompiledPom | null>>();
      const hidden = watchHiddenFiles(root);
      build.onDispose(hidden.close);
      build.onStart(() => {
        hidden.buildStarted();
        compiled = new Map();
        compiler.invalidate();
        // esbuild gives a plugin no logger, so the line goes to the console.
        console.info(includeLine);
      });
      build.onEnd((result) => {
        compiler.invalidate();
        hidden.buildEnded(result.errors.length === 0);
      });
      build.onResolve({ filter: new RegExp(`^${signalSpecifier}$`) }, () => ({
        path: hidden.signal,
      }));

      // The stand-in of a build without ayme is what `onLoad` hands esbuild
      // as the module's contents, and esbuild maps a module to the contents
      // it loaded, so no source map carries the replaced model.
      const compile = async (fileName: string) => {
        const source = await readFile(fileName, "utf8");
        let watched = false;
        const compiledPom = compiler.compile(fileName, source, {
          emit: "js",
          // Before the compile derives anything, so that the files of one
          // that throws are watched too.
          onDependencies: (dependencies) => {
            watched = hidden.watch([fileName, ...dependencies]);
          },
        });
        if (!compiledPom) return null;
        return {
          contents: watched
            ? `${compiledPom.code}\nimport "${signalSpecifier}";\n`
            : compiledPom.code,
          watchFiles: compiledPom.dependencies,
        };
      };

      // A build without ayme resolves the runtime's two entries and the
      // framework packages to their absent entries, wherever they are
      // imported from.
      if (!include)
        build.onResolve({ filter: /^@ayme-dev\// }, (args) => {
          const absent = compiler.absentEntry(args.path);
          if (absent === undefined) return;
          return build.resolve(absent, {
            kind: args.kind,
            importer: args.importer,
            resolveDir: args.resolveDir,
            namespace: "file",
          });
        });

      // Angular's compiler plugin runs first and serves every program file
      // from its own `onLoad`, which has no namespace filter. So a Page Object
      // Model module is claimed while resolving, into a namespace and a path
      // that Angular's `/\.[cm]?[jt]sx?$/` filter does not match. Every other
      // module, including each Angular component, stays with Angular. Bare
      // specifiers count too: tsconfig `paths` resolve them into the workspace.
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.[namespace]) return;
        // A claimed module's own imports arrive from its namespace; resolving
        // them here keeps one copy of an imported base Page Object Model.
        if (args.namespace !== "file" && args.namespace !== namespace) return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer.replace(suffix, ""),
          namespace: "file",
          resolveDir: args.resolveDir,
          pluginData: { [namespace]: true },
        });
        if (
          resolved.errors.length > 0 ||
          resolved.external ||
          !resolved.path.endsWith(".ts") ||
          resolved.path.split(path.sep).includes("node_modules")
        )
          return;
        let pom = compiled.get(resolved.path);
        if (!pom) compiled.set(resolved.path, (pom = compile(resolved.path)));
        try {
          if (!(await pom)) return;
        } catch (error) {
          // Thrown, it would point at the compiler's own code.
          if (!(error instanceof PomCompileError)) throw error;
          // A module that failed imports nothing. Angular watches the files
          // an error's notes name, so the signal file reaches it that way.
          const notes = hidden.watch([resolved.path])
            ? [
                {
                  text: "ayme watches this file and rebuilds when you save it.",
                  location: { file: path.relative(root, hidden.signal) },
                },
              ]
            : [];
          return {
            errors: error.diagnostics.map((diagnostic) => ({
              ...buildError(diagnostic, resolved.path),
              notes,
            })),
          };
        }
        return { path: resolved.path + suffix, namespace };
      });

      build.onLoad({ filter: /\?ayme-pom$/, namespace }, async (args) => {
        const fileName = args.path.slice(0, -suffix.length);
        const pom = await compiled.get(fileName);
        if (!pom)
          throw new Error(
            `ayme did not compile Page Object Model ${fileName}.`
          );
        return {
          contents: pom.contents,
          loader: "js",
          resolveDir: path.dirname(fileName),
          // esbuild watches a module that a plugin loads only through the
          // files the plugin names, the module's own file included.
          watchFiles: [fileName, ...pom.watchFiles],
        };
      });
    },
  };
}

/**
 * Angular's dev server ignores every folder under the workspace whose name
 * starts with a dot, so on its own it may never rebuild after an edit to a
 * Page Object Model in `.ayme/pom/`. The plugin watches those files itself.
 * After an edit it rewrites a signal file outside the workspace, and Angular
 * rebuilds for that file: each such module imports it, and the error of one
 * that failed to compile names it.
 */
function watchHiddenFiles(root: string) {
  const signal = path.join(
    os.tmpdir(),
    `ayme-angular-${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
    "rebuild.js"
  );
  // Each watched file: what stops its watch, and its version when the last
  // build started.
  const watched = new Map<string, { version: string; stop: () => void }>();
  // The files the running build, or else the last one, has named.
  let named = new Set<string>();
  let building = false;
  let editedWhileBuilding = false;
  let check: NodeJS.Timeout | undefined;
  // Angular is waited for until it has once left an edit without a rebuild.
  let wait = ownRebuildMs;
  let signalIsThere: boolean | undefined;

  // Whether the signal file is there afterwards. A temp folder that cannot
  // be written leaves the build as it is without this watch.
  const writeSignal = (contents: string, flag?: "wx") => {
    try {
      mkdirSync(path.dirname(signal), { recursive: true });
      writeFileSync(signal, contents, { flag });
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EEXIST";
    }
  };
  const versionOf = (file: string) => {
    const stat = statSync(file, { throwIfNoEntry: false });
    return stat
      ? `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`
      : "";
  };
  const isHidden = (file: string) => {
    const folder = path.relative(root, path.dirname(file));
    if (
      folder === ".." ||
      folder.startsWith(`..${path.sep}`) ||
      path.isAbsolute(folder)
    )
      return false;
    const segments = folder.split(path.sep);
    return (
      !segments.includes("node_modules") &&
      segments.some((segment) => segment.startsWith("."))
    );
  };
  // A build that started after the edits has compiled them already.
  const rebuildIfUnseen = () => {
    check = undefined;
    if (building) {
      editedWhileBuilding = true;
      return;
    }
    for (const [file, { version }] of watched) {
      if (versionOf(file) === version) continue;
      wait = 0;
      writeSignal(`// ${Date.now()}\n`);
      return;
    }
  };
  const edited = () => {
    if (wait === 0) rebuildIfUnseen();
    else check ??= setTimeout(rebuildIfUnseen, wait).unref();
  };

  return {
    /** The file Angular watches in place of the files it ignores. */
    signal,
    /**
     * Watches those of `files` that Angular ignores. Returns whether it
     * watches any, which is when their module is to reach the signal file.
     */
    watch(files: readonly string[]) {
      const hidden = files.filter(isHidden);
      if (hidden.length === 0) return false;
      // Created once and never emptied: another build of this workspace may
      // be watching it.
      signalIsThere ??= writeSignal("", "wx");
      if (!signalIsThere) return false;
      for (const file of hidden) {
        named.add(file);
        if (watched.has(file)) continue;
        // Polled, as Angular's `--poll` is for file systems without change
        // events. Not persistent: a build that only builds must still exit.
        watchFile(
          file,
          { interval: hiddenFilePollMs, persistent: false },
          edited
        );
        watched.set(file, {
          version: versionOf(file),
          stop: () => unwatchFile(file, edited),
        });
      }
      return true;
    },
    buildStarted() {
      building = true;
      named = new Set();
      for (const [file, entry] of watched) entry.version = versionOf(file);
    },
    /** A build that succeeded has named every file still in use. */
    buildEnded(succeeded: boolean) {
      building = false;
      if (succeeded)
        for (const [file, { stop }] of watched) {
          if (named.has(file)) continue;
          stop();
          watched.delete(file);
        }
      if (!editedWhileBuilding) return;
      editedWhileBuilding = false;
      edited();
    },
    close() {
      clearTimeout(check);
      for (const { stop } of watched.values()) stop();
      watched.clear();
    },
  };
}

/**
 * `diagnostic` as an esbuild error. Without a file it is at `compiled`, the
 * module whose compile failed.
 */
function buildError(
  diagnostic: PomDiagnostic,
  compiled: string
): PartialMessage {
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
 * The factory `@angular-builders/custom-esbuild` loads from the plugin file.
 * For a `{ path, options }` entry it calls `factory(options, builderOptions,
 * target)`; the string form passes the builder's options first instead.
 */
export default aymeAngular;
