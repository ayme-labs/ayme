import { join } from "node:path";
import { Rolldown } from "tsdown";

const moduleId = "virtual:ayme-in-page";
const resolvedId = `\0${moduleId}`;
const pagePart = join(
  import.meta.dirname,
  "..",
  "src",
  "in-page",
  "page",
  "install.ts"
);

/**
 * `virtual:ayme-in-page`: the in-page module's page part as one
 * self-contained function, `installInPage`, the way Playwright Lite's build
 * splices Playwright's injected script into its bundle. The page part and
 * everything it imports are bundled on their own, then wrapped in the
 * function's body, so it closes over nothing: Playwright Lite calls it in the
 * page, and real Playwright sends its source text. The package build and both
 * test lanes load this plugin.
 */
export function inPageModule() {
  return {
    name: "ayme-in-page",
    resolveId(id: string) {
      if (id === moduleId) return resolvedId;
    },
    async load(
      this: { addWatchFile?(id: string): void },
      id: string
    ): Promise<string | undefined> {
      if (id !== resolvedId) return;
      const { output } = await Rolldown.build({
        input: pagePart,
        platform: "browser",
        write: false,
        // No build-machine paths, as in the package's own build.
        experimental: { attachDebugInfo: "none" },
        output: { format: "cjs", comments: false },
      });
      if (output.length !== 1 || output[0].type !== "chunk")
        throw new Error("The in-page module must build into one chunk.");
      const [chunk] = output;
      for (const module of chunk.moduleIds) this.addWatchFile?.(module);
      return [
        "export function installInPage(argument) {",
        '"use strict";',
        "const module = { exports: {} };",
        "const exports = module.exports;",
        chunk.code,
        "return module.exports.install(argument);",
        "}",
      ].join("\n");
    },
  };
}
