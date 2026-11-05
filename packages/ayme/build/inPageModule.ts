import { join } from "node:path";
import { Rolldown } from "tsdown";

import { pinnedAriaSnapshotModule } from "./pinnedAriaSnapshot.ts";

const moduleId = "virtual:ayme-in-page";
const resolvedId = `\0${moduleId}`;
const ariaSnapshotId = "virtual:ayme-aria-snapshot";
const resolvedAriaSnapshotId = `\0${ariaSnapshotId}`;
const pagePart = join(import.meta.dirname, "..", "src", "in-page", "page");

/**
 * The functions `virtual:ayme-in-page` exports: each a file of the page part
 * and the export of it the function returns the result of.
 */
const functions = [
  { name: "installInPage", file: "install.ts", call: "install" },
  { name: "callInPage", file: "call.ts", call: "call" },
  { name: "aymeRefEngine", file: "refEngine.ts", call: "engine" },
];

/**
 * `virtual:ayme-in-page`: the in-page module's page part as self-contained
 * functions, the way Playwright Lite's build splices Playwright's injected
 * script into its bundle. `installInPage` holds the whole module; the others
 * are the small functions a host sends to reach it. Each file and everything
 * it imports is bundled on its own, then wrapped in the function's body, so
 * it closes over nothing: Playwright Lite calls it in the page, and real
 * Playwright sends its source text. The page part's snapshot code is the
 * pinned Playwright's (`virtual:ayme-aria-snapshot`, build/pinnedAriaSnapshot.ts).
 * The package build and both test lanes load this plugin.
 */
export function inPageModule() {
  return {
    name: "ayme-in-page",
    resolveId(id: string) {
      if (id === moduleId) return resolvedId;
      // Only the page part's own build bundles the snapshot code; the
      // declarations build reaches it through the page part's types.
      if (id === ariaSnapshotId) return { id, external: true };
    },
    async load(
      this: { addWatchFile?(id: string): void },
      id: string
    ): Promise<string | undefined> {
      if (id !== resolvedId) return;
      const built = await Promise.all(
        functions.map(async ({ name, file, call }) => {
          const chunk = await buildSelfContained(join(pagePart, file));
          for (const module of chunk.moduleIds)
            if (!module.startsWith("\0")) this.addWatchFile?.(module);
          return [
            `export function ${name}(argument) {`,
            '"use strict";',
            "const module = { exports: {} };",
            "const exports = module.exports;",
            chunk.code,
            `return module.exports.${call}(argument);`,
            "}",
          ].join("\n");
        })
      );
      return built.join("\n");
    },
  };
}

async function buildSelfContained(input: string) {
  const { output } = await Rolldown.build({
    input,
    platform: "browser",
    write: false,
    // No build-machine paths, as in the package's own build.
    experimental: { attachDebugInfo: "none" },
    output: { format: "cjs", comments: false },
    plugins: [
      {
        name: "ayme-aria-snapshot",
        resolveId: (id) =>
          id === ariaSnapshotId ? resolvedAriaSnapshotId : undefined,
        load: (id) =>
          id === resolvedAriaSnapshotId
            ? {
                code: pinnedAriaSnapshotModule(),
                moduleSideEffects: false,
              }
            : undefined,
      },
    ],
  });
  if (output.length !== 1 || output[0].type !== "chunk")
    throw new Error("Each in-page function must build into one chunk.");
  return output[0];
}
