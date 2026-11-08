import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import type * as Esbuild from "esbuild";

import { ENTRY_MODULE, RUNTIME_MODULE } from "../domain/servedPageObjects";

/** The built modules, by their path under the served path. */
export type BuiltModules = ReadonlyMap<string, string>;

/** The build plugin's esbuild adapter, as `@ayme-dev/unplugin-ayme/angular` exports it. */
type AymeEsbuildAdapter = {
  aymeAngular(options: { include: boolean }): Esbuild.Plugin;
};

const PLUGIN = "@ayme-dev/unplugin-ayme/angular";
const RUNTIME = "@ayme-dev/ayme";
/** The runtime entry's id, which no file on disk has. */
const RUNTIME_ENTRY = "ayme-served-runtime";

/**
 * Builds `entry` once for the browser, with esbuild and the build plugin's
 * esbuild adapter, as minified ES modules split into chunks: `entry.js`,
 * whose default export is the entry's, and `runtime.js`, which re-exports
 * `@ayme-dev/ayme`; both share one copy of the runtime. What the runtime
 * imports lazily, such as the Inspector and the screenshot renderer, stays
 * in chunks of its own, which a page fetches on first use. Every import,
 * the runtime's and the build plugin's included, resolves from the entry's
 * folder, as in a build of the project itself, so the page runs the
 * project's own `@ayme-dev/ayme`.
 */
export async function buildPageObjects(entry: string): Promise<BuiltModules> {
  const folder = dirname(entry);
  const pluginFile = resolveFrom(folder, PLUGIN, entry);
  // The build plugin's own peer, so the plugin and the build agree.
  const esbuildModule = await importFile<
    typeof Esbuild & { default?: typeof Esbuild }
  >(resolveFrom(dirname(pluginFile), "esbuild", entry));
  // esbuild is CommonJS: Node may hand its exports over as the default.
  const esbuild = esbuildModule.default ?? esbuildModule;
  const { aymeAngular } = await importFile<AymeEsbuildAdapter>(pluginFile);
  // Nothing is written there: the outputs stay in memory.
  const outdir = join(folder, "ayme-served");
  const { outputFiles } = await esbuild
    .build({
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
      plugins: [runtimeEntry(folder), aymeAngular({ include: true })],
    })
    .catch((error: unknown) => {
      throw new Error(
        `Building the Page Objects entry ${entry} failed: ${(error as Error).message}`,
        { cause: error }
      );
    });
  return new Map(
    outputFiles.map((file) => [
      relative(outdir, file.path).split("\\").join("/"),
      file.text,
    ])
  );
}

/** The runtime's entry: a module that re-exports `@ayme-dev/ayme` from `folder`. */
function runtimeEntry(folder: string): Esbuild.Plugin {
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
