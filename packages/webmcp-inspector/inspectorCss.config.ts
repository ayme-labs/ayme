import { fileURLToPath } from "node:url";

import { shadowTailwind } from "@ayme-dev/design-system/shadow-tailwind";

/**
 * Serves src/inspector.css, compiled by Tailwind for the Inspector's shadow
 * root, as the string module `virtual:ayme-inspector-css` (typed in
 * src/env.d.ts). The build and the tests share it. The configs import this
 * file with its .ts extension so Node's type stripping can load it.
 */
export function inspectorCss() {
  return shadowTailwind({
    entry: fileURLToPath(new URL("./src/inspector.css", import.meta.url)),
    moduleId: "virtual:ayme-inspector-css",
  });
}
