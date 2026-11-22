import { fileURLToPath } from "node:url";

import { shadowTailwind } from "@ayme-dev/design-system/shadow-tailwind";

/**
 * Serves src/app/window.css, compiled by Tailwind, as the string module
 * `virtual:ayme-recorder-window-css` (typed in src/app/env.d.ts). The configs
 * import this file with its .ts extension so Node's type stripping can load
 * it.
 */
export function windowCss() {
  return shadowTailwind({
    entry: fileURLToPath(new URL("./src/app/window.css", import.meta.url)),
    moduleId: "virtual:ayme-recorder-window-css",
  });
}

/** Serves src/app/toolbar.css, compiled by Tailwind, as the string module
 * `virtual:ayme-recorder-toolbar-css` (typed in src/app/env.d.ts). */
export function toolbarCss() {
  return shadowTailwind({
    entry: fileURLToPath(new URL("./src/app/toolbar.css", import.meta.url)),
    moduleId: "virtual:ayme-recorder-toolbar-css",
  });
}
