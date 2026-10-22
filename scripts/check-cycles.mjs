/**
 * Fails on a cycle of runtime imports inside a workspace's `src`.
 *
 *   node scripts/check-cycles.mjs packages/*\/src apps/*\/src
 *
 * Each `src` is read with madge, resolving imports through the workspace's
 * own `tsconfig.json`, so its path aliases and its package's self-imports
 * through `exports` count as edges. madge's own `--ts-config` loses both: it
 * hands the resolver options that were already parsed, and the resolver
 * parses them again.
 *
 * Type-only imports are skipped, in `.ts`, `.tsx` and `.vue` files alike:
 * `verbatimModuleSyntax` erases them. `import { type T }` is not skipped by
 * the language, since it keeps an empty import, so lint requires
 * `import type { T }` instead (`no-import-type-side-effects`).
 *
 * Left out: test fixtures, which are input shaped on purpose, and generated
 * shadcn-vue components, each of which imports its variants from the index
 * that re-exports it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import madge from "madge";
import ts from "typescript";

const skipTypeImports = { skipTypeImports: true };

/** Each runtime import cycle in the given `src` directories, as `src: a > b`. */
export async function findCycles(sourceDirs) {
  const cycles = [];
  for (const sourceDir of sourceDirs) {
    const tsconfigPath = path.join(path.dirname(sourceDir), "tsconfig.json");
    const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      path.dirname(tsconfigPath)
    );
    const graph = await madge(sourceDir, {
      fileExtensions: ["ts", "tsx"],
      excludeRegExp: [/(^|\/)fixtures\//, /(^|\/)components\/ui\//],
      tsConfig: { options },
      detectiveOptions: {
        ts: skipTypeImports,
        tsx: skipTypeImports,
        vue: skipTypeImports,
      },
    });
    for (const cycle of graph.circular()) {
      cycles.push(`${sourceDir}: ${cycle.join(" > ")}`);
    }
  }
  return cycles;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cycles = await findCycles(process.argv.slice(2));
  for (const cycle of cycles) console.error(cycle);
  if (cycles.length > 0) process.exit(1);
  console.log("no runtime import cycles");
}
