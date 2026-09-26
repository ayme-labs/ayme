import { fileURLToPath } from "node:url";

import { shadowTailwind } from "@ayme-dev/design-system/shadow-tailwind";

/**
 * Serves src/inspector.css, compiled by Tailwind for the Inspector's shadow
 * root, as the string module `virtual:ayme-inspector-css` (typed in
 * src/env.d.ts). The build and the tests share it.
 *
 * The design system ships the plugin as TypeScript source with an
 * extensionless relative import, which Node's own type stripping cannot load.
 * tsdown's and Vite's default config loaders hand workspace packages to Node,
 * so the package scripts pick loaders that transpile it: `tsdown
 * --config-loader tsx` and `vitest --configLoader runner`.
 */
export function inspectorCss() {
  return shadowTailwind({
    entry: fileURLToPath(new URL("./src/inspector.css", import.meta.url)),
    moduleId: "virtual:ayme-inspector-css",
  });
}
