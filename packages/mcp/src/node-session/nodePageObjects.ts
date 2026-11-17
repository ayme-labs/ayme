// Spike: the project's Page Objects entry, built for Node and imported. The
// same compiler plugin as the browser build's; no watch, so an edit needs a
// restart.
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { pageObjectModels } from "../served-page-objects";

type PomCompilerEntry = {
  createPomCompiler(options: {
    include: boolean;
  }): Parameters<typeof pageObjectModels>[0];
};

/**
 * The classes `entry` exports by default, compiled with the project's own
 * Page Object compiler and bundled as one ES module for Node. Packages stay
 * imports, so the classes register with the `@ayme-dev/ayme` the session
 * runs, not a second copy.
 *
 * Placeholder: the bundle is written beside the entry for as long as its
 * import takes, so Node resolves its packages from the entry's folder.
 */
export async function loadNodePageObjects(
  entry: string
): Promise<readonly unknown[]> {
  const folder = dirname(entry);
  const compilerFile = createRequire(join(folder, "index.js")).resolve(
    "@ayme-dev/ayme/compiler"
  );
  const { createPomCompiler } = (await import(
    pathToFileURL(compilerFile).href
  )) as PomCompilerEntry;
  const outfile = join(folder, `.page-objects.node.${process.pid}.mjs`);
  const { outputFiles } = await esbuild.build({
    absWorkingDir: folder,
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    write: false,
    outfile,
    logLevel: "silent",
    plugins: [pageObjectModels(createPomCompiler({ include: true }))],
  });
  writeFileSync(outfile, outputFiles[0]!.text);
  try {
    const built = (await import(pathToFileURL(outfile).href)) as {
      default?: unknown;
    };
    if (!Array.isArray(built.default))
      throw new Error(
        `The Page Objects entry ${entry} has no default export that lists Page Object classes.`
      );
    return built.default as readonly unknown[];
  } finally {
    rmSync(outfile, { force: true });
  }
}
