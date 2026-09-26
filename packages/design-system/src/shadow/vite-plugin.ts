import { readFile } from "node:fs/promises";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Plugin } from "vite";

import { remToPx, unwrapPropertyFallback } from "./postcss";

export type ShadowTailwindOptions = {
  /** Absolute path of the Tailwind entry stylesheet to compile. */
  entry: string;
  /** The virtual module id the compiled stylesheet is served under. */
  moduleId: string;
};

/**
 * Compiles a Tailwind v4 entry into a stylesheet that works inside a shadow
 * root, with the transforms in `./postcss`. Exported for tests and for
 * bundlers other than Vite.
 */
export async function compileShadowCss(entry: string): Promise<string> {
  const result = await postcss([
    tailwind({ optimize: { minify: true } }),
    unwrapPropertyFallback(),
    remToPx(),
  ]).process(await readFile(entry, "utf8"), { from: entry });
  return result.css;
}

/**
 * Serves a Tailwind v4 entry, compiled for a shadow root, as a virtual string
 * module. The CSS reaches the bundle as a JS string, never as an imported
 * stylesheet: Vite injects imported CSS into the host document's <head>, which
 * an embedded panel must not do.
 *
 * The consumer declares the module's type, e.g.
 * `declare module "virtual:my-panel-css" { const css: string; export default css; }`.
 */
export function shadowTailwind({
  entry,
  moduleId,
}: ShadowTailwindOptions): Plugin {
  const resolvedModuleId = `\0${moduleId}`;
  return {
    name: "ayme-shadow-tailwind",
    resolveId: (id) => (id === moduleId ? resolvedModuleId : null),
    async load(id) {
      if (id !== resolvedModuleId) return null;
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(await compileShadowCss(entry))};`;
    },
  };
}
