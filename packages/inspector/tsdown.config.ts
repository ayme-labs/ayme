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
  // lucide-react has no exports map, so the bundler would take its "main":
  // one CommonJS file that holds every icon and can't be tree-shaken. Its ES
  // build keeps each icon in a module of its own, so only those used stay.
  alias: { "lucide-react": "lucide-react/dist/esm/lucide-react.mjs" },
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    // Bundled third-party code keeps its license notices (see the file).
    copy: ["THIRD_PARTY_NOTICES.txt"],
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
    // browser window on its own, and puts inside the page an Agent App
    // shows, so nothing is left to resolve there: React, Ayme's contract
    // entry and the MCP Apps SDK are inside it, and the Inspector shares its
    // output with no other entry (a chunk would be a second file to serve).
    // Minified: no bundler reads it after this one, and an Agent App gets
    // the whole script inside every page it shows.
    ...shared,
    clean: false,
    dts: false,
    minify: true,
    entry: { external: "src/external.ts" },
    deps: {
      alwaysBundle: [
        /^react(-dom)?(\/|$)/,
        /^radix-ui(\/|$)/,
        /^@ayme-dev\//,
        /^@modelcontextprotocol\/ext-apps\//,
      ],
    },
  },
]);
