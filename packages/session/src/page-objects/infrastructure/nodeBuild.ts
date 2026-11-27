// Builds a project's Page Objects for Node, with esbuild and the project's
// own Page Object compiler, and loads them.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Exit, Layer } from "effect";
import * as esbuild from "esbuild";

import { PageObjectsBuild } from "../../session/application";
import { SessionStartError } from "../../session/domain";
import {
  buildFailed,
  compileErrors,
  pageObjectClasses,
  type PomDiagnostic,
} from "./builtEntry";
import { ENTRY, projectAyme, type ProjectAyme } from "./projectAyme";
import { sourceWatch } from "./sourceWatch";

/** The project's Page Objects, built and loaded for Node. */
export type NodePageObjects = {
  /** The classes the entry lists, registered with the project's own
   * `@ayme-dev/ayme`. */
  readonly classes: readonly unknown[];
  /** The file of the project's `@ayme-dev/ayme/internal`, which runs
   * them. */
  readonly nodeHost: string;
};

/** What the Session uses of the project's `@ayme-dev/ayme/compiler`. */
type CompilerEntry = {
  createPomCompiler(options: { include: boolean }): {
    compile(
      fileName: string,
      source: string,
      options: { emit: "js" }
    ): { code: string } | null;
  };
  PomCompileError: new (...args: never[]) => Error & {
    readonly diagnostics: readonly PomDiagnostic[];
  };
};

/** Imports `file`; what it throws as it loads fails the start, saying
 * `what` did not load. */
const importFile = <A>(file: string, what: string) =>
  Effect.tryPromise({
    try: () => import(pathToFileURL(file).href) as Promise<A>,
    catch: (cause) =>
      new SessionStartError(
        `${what} did not load: ${cause instanceof Error ? cause.message : String(cause)}`
      ),
  });

/** Whether `file` is in a `node_modules` folder: installed, not the
 * project's own source. */
const installed = (file: string) => file.split(sep).includes("node_modules");

/**
 * Compiles each Page Object Model outside `node_modules` with the
 * project's compiler; every other module builds as esbuild builds it.
 */
const pageObjectModels = ({
  createPomCompiler,
  PomCompileError,
}: CompilerEntry): esbuild.Plugin => ({
  name: "ayme-page-object-models",
  setup(build) {
    const compiler = createPomCompiler({ include: true });
    build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
      if (installed(path)) return undefined;
      try {
        const pom = compiler.compile(path, await readFile(path, "utf8"), {
          emit: "js",
        });
        return pom === null ? undefined : { contents: pom.code, loader: "js" };
      } catch (error) {
        if (!(error instanceof PomCompileError)) throw error;
        return { errors: compileErrors(error.diagnostics, path) };
      }
    });
  },
});

/**
 * Whether `specifier` names a package installed for a module in `dir`: one
 * in the `node_modules` of `dir` or of a folder above it, where Node finds
 * it, whether it is a folder there or a link to one elsewhere, such as a
 * workspace package. Anything else a bare specifier reaches, such as a
 * tsconfig path alias, is the project's own source.
 */
function installedPackage(specifier: string, dir: string): boolean {
  const [scope, name] = specifier.split("/");
  const folder = scope!.startsWith("@") ? join(scope!, name ?? "") : scope!;
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules", folder))) return true;
    if (dirname(at) === at) return false;
  }
}

/** Marks the resolve `projectPackages` asks esbuild for itself. */
const RESOLVING = Symbol("ayme-project-packages");

/** An import of `@ayme-dev/ayme` or one of its entries. */
const AYME_IMPORT = /^@ayme-dev\/ayme(\/|$)/;

/**
 * Leaves every installed package the Page Objects import out of the build,
 * imported from the file the project installed: Node then loads the
 * project's own copies, wherever the built module is. An import that
 * resolves to the project's own source, such as one through a tsconfig path
 * alias, is built with the rest.
 *
 * `@ayme-dev/ayme` is always the copy installed for `projectDir`, the one
 * the compiler and the Node Host come from: a class registers with the copy
 * its module imports, and a model in a linked folder with an install of its
 * own would otherwise register with that one, which the Node Host never
 * reads.
 */
const projectPackages = (projectDir: string): esbuild.Plugin => ({
  name: "ayme-project-packages",
  setup(build) {
    build.onResolve({ filter: /^[^./#]/ }, async (args) => {
      if (isBuiltin(args.path)) return { external: true };
      if (args.pluginData === RESOLVING) return undefined;
      const resolveDir = AYME_IMPORT.test(args.path)
        ? projectDir
        : args.resolveDir;
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir,
        pluginData: RESOLVING,
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      if (!installedPackage(args.path, resolveDir))
        return { path: resolved.path };
      return { path: pathToFileURL(resolved.path).href, external: true };
    });
  },
});

/** The files esbuild tries for an import of `path` from `dir`, in the order
 * of its default extensions. */
const candidatesOf = (path: string, dir: string) => {
  const base = join(dir, path);
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];
  return [
    base,
    ...extensions.map((extension) => base + extension),
    ...extensions.map((extension) => join(base, `index${extension}`)),
  ];
};

/** Tells `reads` of each file of the project the build loads, whether the
 * build succeeds or not, and of each file a relative import could reach,
 * which a file that does not exist yet may fix: the source an edit
 * changes. */
const readFiles = (reads: (file: string) => void): esbuild.Plugin => ({
  name: "ayme-read-files",
  setup(build) {
    build.onResolve({ filter: /^\.\.?(\/|$)/ }, ({ path, resolveDir }) => {
      for (const candidate of candidatesOf(path, resolveDir))
        if (!installed(candidate)) reads(candidate);
      return undefined;
    });
    build.onLoad({ filter: /.*/ }, ({ path }) => {
      if (!installed(path)) reads(path);
      return undefined;
    });
  },
});

/** The entry built into one ES module, or the build's messages; `reads`
 * hears of each file of the project it reads. */
const bundle = (
  entry: string,
  compiler: CompilerEntry,
  reads: (file: string) => void
) => {
  // The project folder, which holds the ayme folder.
  const projectDir = join(dirname(entry), "..");
  return Effect.tryPromise({
    try: () =>
      esbuild.build({
        // Messages name files from the project folder.
        absWorkingDir: projectDir,
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        outfile: "page-objects.mjs",
        // A class keeps the name it is declared with, which the entry check
        // compares, where two of one name would otherwise be renamed apart.
        keepNames: true,
        logLevel: "silent",
        plugins: [
          readFiles(reads),
          projectPackages(projectDir),
          pageObjectModels(compiler),
        ],
      }),
    catch: (failure) => failure as esbuild.BuildFailure,
  }).pipe(
    Effect.map(({ outputFiles }) => outputFiles[0]!.text),
    Effect.catch((failure) =>
      Effect.promise(() =>
        esbuild.formatMessages(failure.errors ?? [{ text: String(failure) }], {
          kind: "error",
          color: false,
        })
      ).pipe(
        Effect.flatMap((messages) =>
          Effect.fail(buildFailed(entry, messages, failure.errors ?? []))
        )
      )
    )
  );
};

/** Why the start failed when the built module of `entry` could not be
 * written to a file in `folder`, which Node imports it from. */
const notWritten = (entry: string, folder: string, cause: unknown) =>
  new SessionStartError(
    `ayme could not write the built Page Objects of ${entry} to a file in ${folder}: ${cause instanceof Error ? cause.message : String(cause)}`
  );

/** Imports `code` as an ES module, from a file of its own that is removed
 * once it loaded. */
const load = (code: string, entry: string) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "ayme-page-objects-")),
      catch: (cause) => notWritten(entry, tmpdir(), cause),
    }),
    (folder) =>
      Effect.tryPromise({
        try: async () => {
          const file = join(folder, "page-objects.mjs");
          await writeFile(file, code);
          return file;
        },
        catch: (cause) => notWritten(entry, folder, cause),
      }).pipe(
        Effect.flatMap((file) =>
          importFile<{ default?: unknown }>(
            file,
            `The Page Objects of ${entry}`
          )
        )
      ),
    (folder) =>
      Effect.promise(() => rm(folder, { recursive: true, force: true }))
  );

/** Builds the project's Page Objects for Node and loads them, with the
 * project's own `@ayme-dev/ayme`; `reads` hears of each file of the
 * project the build reads. */
const buildForNode = (
  { entry, compiler, nodeHost }: ProjectAyme,
  reads: (file: string) => void
): Effect.Effect<NodePageObjects, SessionStartError> =>
  importFile<CompilerEntry>(
    compiler,
    `The Page Object compiler of the project's @ayme-dev/ayme, ${compiler},`
  ).pipe(
    Effect.flatMap((compilerEntry) => bundle(entry, compilerEntry, reads)),
    Effect.flatMap((code) => load(code, entry)),
    Effect.flatMap((module) => pageObjectClasses(module, entry)),
    Effect.map((classes) => ({ classes, nodeHost }))
  );

/** The build of the Page Objects of the project in `projectDir`, on its own
 * `@ayme-dev/ayme`, which must be `aymeVersion`, this ayme's version. Its
 * edits are those to its entry and to the files its builds read, watched
 * until the scope of a build closes. */
export const projectPageObjects = (
  projectDir: string,
  aymeVersion: string
): Layer.Layer<PageObjectsBuild> => {
  const watch = sourceWatch();
  return Layer.succeed(PageObjectsBuild, {
    build: Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(watch.close));
      watch.began();
      // Watched also when it is missing, so its return is an edit.
      watch.reads(join(projectDir, ENTRY));
      return yield* projectAyme(projectDir, aymeVersion).pipe(
        Effect.flatMap((project) => buildForNode(project, watch.reads)),
        Effect.onExit((exit) =>
          Effect.sync(() => watch.finished(Exit.isFailure(exit)))
        )
      );
    }),
    edits: watch.edits,
    unwatched: watch.lost,
  });
};
