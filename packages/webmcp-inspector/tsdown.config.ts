import { defineConfig } from "tsdown";

import { inspectorCss } from "./inspectorCss.config";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/demo.ts"],
  format: ["esm"],
  deps: {
    // The Inspector brings its own React: a host app may run another React
    // version, or none, and must never share or clash with this one.
    alwaysBundle: [/^react(-dom)?(\/|$)/, /^radix-ui(\/|$)/],
  },
  // Pick React's production build now: the output must not depend on the
  // host's bundler replacing process.env.NODE_ENV.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // Radix marks its modules "use client", a React Server Components boundary
  // that means nothing in this browser-only bundle.
  suppressWarnings: [/module level directive "use client"/],
  plugins: [inspectorCss()],
});
