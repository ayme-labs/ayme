import type { Plugin } from "postcss";

/**
 * `@property` is ignored inside a shadow tree, so Tailwind's `--tw-*` initial
 * values never apply there and shadow-*, ring-*, translate-* and gradient
 * utilities produce nothing. Tailwind emits the explicit fallback we need
 * behind an `@supports` guard for old browsers; unwrap it so it always applies,
 * and add `:host` so utilities on the host work too. Fails the build if a
 * Tailwind upgrade stops emitting that block.
 */
export const unwrapPropertyFallback = (): Plugin => ({
  postcssPlugin: "shadow-unwrap-property-fallback",
  OnceExit(root) {
    let unwrapped = 0;
    root.walkAtRules("layer", (layer) => {
      if (layer.params.trim() !== "properties") return;
      layer.walkAtRules("supports", (supports) => {
        supports.replaceWith(supports.nodes ?? []);
        unwrapped++;
      });
      layer.walkRules((rule) => {
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
export const remToPx = (): Plugin => {
  const toPx = (value: string) =>
    value.replace(
      /(-?\d*\.?\d+)rem\b/g,
      (_, n: string) => `${+(parseFloat(n) * 16).toFixed(4)}px`
    );
  return {
    postcssPlugin: "shadow-rem-to-px",
    OnceExit(root) {
      root.walkDecls((declaration) => {
        if (declaration.value.includes("rem"))
          declaration.value = toPx(declaration.value);
      });
      root.walkAtRules((atRule) => {
        if (atRule.params.includes("rem")) atRule.params = toPx(atRule.params);
      });
    },
  };
};
