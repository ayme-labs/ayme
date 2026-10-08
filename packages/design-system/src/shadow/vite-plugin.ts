// One module with no relative imports: build configs load it with Node's own
// TypeScript support, which needs file extensions that consumers' tsconfigs
// would reject.
import { readFile } from "node:fs/promises";

import tailwind from "@tailwindcss/postcss";
import postcss, { type Plugin as PostcssPlugin } from "postcss";
import type { Plugin } from "vite";

/**
 * `@property` is ignored inside a shadow tree, so Tailwind's `--tw-*` initial
 * values never apply there and shadow-*, ring-*, translate-* and gradient
 * utilities produce nothing. Tailwind emits the explicit fallback we need
 * behind an `@supports` guard for old browsers; unwrap it so it always applies,
 * and add `:host` so utilities on the host work too. Fails the build if a
 * Tailwind upgrade stops emitting that block.
 */
const unwrapPropertyFallback = (): PostcssPlugin => ({
  postcssPlugin: "shadow-unwrap-property-fallback",
  OnceExit(root) {
    let unwrapped = 0;
    root.walkAtRules("layer", (layer) => {
      // Stryker disable next-line MethodExpression: PostCSS keeps the whitespace around params in raws, so trim() never changes them.
      if (layer.params.trim() !== "properties") return;
      layer.walkAtRules("supports", (supports) => {
        supports.replaceWith(supports.nodes ?? []);
        // Stryker disable next-line UpdateOperator: only zero versus non-zero is read, and counting down agrees on that.
        unwrapped++;
      });
      layer.walkRules((rule) => {
        // Stryker disable next-line ConditionalExpression,StringLiteral: the only rule Tailwind puts in this layer starts with *, so the check never skips one.
        if (rule.selector.startsWith("*"))
          rule.selector = `:host, ${rule.selector}`;
      });
    });

    const css = root.toString();
    const hasInitials =
      css.includes("--tw-shadow: 0 0 #0000") ||
      css.includes("--tw-shadow:0 0 #0000");
    if (!unwrapped || !hasInitials) {
      throw new Error(
        "shadow-tailwind: Tailwind no longer emits the @layer properties fallback this build " +
          "depends on. @property is ignored inside shadow roots, so the --tw-* initial values " +
          "must come from somewhere else."
      );
    }
  },
});

/**
 * `rem` inside a shadow root still resolves against the host document's <html>
 * font-size, which the host page controls. Converting after compilation, at
 * the browser default of 16px, keeps the tokens in the units they are written in.
 */
const remToPx = (): PostcssPlugin => {
  const toPx = (value: string) =>
    value.replace(
      /(-?\d*\.?\d+)rem\b/g,
      (_, n: string) => `${+(parseFloat(n) * 16).toFixed(4)}px`
    );
  return {
    postcssPlugin: "shadow-rem-to-px",
    OnceExit(root) {
      root.walkDecls((declaration) => {
        // Stryker disable next-line ConditionalExpression,StringLiteral: a shortcut only; toPx leaves a value without rem unchanged.
        if (declaration.value.includes("rem"))
          declaration.value = toPx(declaration.value);
      });
      root.walkAtRules((atRule) => {
        // Stryker disable next-line ConditionalExpression,StringLiteral: a shortcut only; toPx leaves params without rem unchanged.
        if (atRule.params.includes("rem")) atRule.params = toPx(atRule.params);
      });
    },
  };
};

export type ShadowTailwindOptions = {
  /** Absolute path of the Tailwind entry stylesheet to compile. */
  entry: string;
  /** The virtual module id the compiled stylesheet is served under. */
  moduleId: string;
};

/**
 * Compiles a Tailwind v4 entry into a stylesheet that works inside a shadow
 * root, with the transforms above. Exported for tests and for bundlers other
 * than Vite.
 */
export async function compileShadowCss(entry: string): Promise<string> {
  // Stryker disable next-line StringLiteral: without an encoding readFile returns a Buffer, which PostCSS reads as the same text.
  const source = await readFile(entry, "utf8");
  const result = await postcss([
    tailwind({ optimize: { minify: true } }),
    unwrapPropertyFallback(),
    remToPx(),
  ]).process(source, { from: entry });
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
