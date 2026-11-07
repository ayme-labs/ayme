import { defineConfig } from "tsdown";

import { inspectorCss } from "./inspectorCss.config.ts";

const shared = {
  format: ["esm"] as ["esm"],
  // Pick React's production build now: the output must not depend on the
  // host's bundler replacing process.env.NODE_ENV.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // Radix marks its modules "use client", a React Server Components boundary
  // that means nothing in this browser-only bundle.
  suppressWarnings: [/module level directive "use client"/],
  plugins: [inspectorCss()],
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: true,
    entry: {
      index: "src/index.ts",
      testing: "src/testing/index.ts",
    },
    deps: {
      // The Inspector brings its own React: a host app may run another React
      // version, or none, and must never share or clash with this one.
      alwaysBundle: [/^react(-dom)?(\/|$)/, /^radix-ui(\/|$)/],
    },
  },
  {
    // The external build (ADR-0049): one script `ayme mcp` serves to a
    // browser window on its own, so nothing is left to resolve there: React
    // and Ayme's contract entry are inside it, and the Inspector shares its
    // output with no other entry (a chunk would be a second file to serve).
    ...shared,
    clean: false,
    dts: false,
    entry: { external: "src/external.ts" },
    deps: {
      alwaysBundle: [/^react(-dom)?(\/|$)/, /^radix-ui(\/|$)/, /^@ayme-dev\//],
    },
  },
]);
