import { defineConfig } from "tsdown";

import { bundledPackages } from "./bundledPackages.config.ts";
import { windowCss } from "./windowCss.config.ts";

// Omit build-machine source paths, not copyright or license comments.
const inputOptions = { experimental: { attachDebugInfo: "none" as const } };

export default defineConfig([
  {
    // Test-only page objects (ADR-0026).
    clean: true,
    inputOptions,
    dts: true,
    entry: { testing: "src/testing/index.ts" },
    format: ["esm"],
    // Playwright is the test's own: the page objects only name its types.
    deps: { neverBundle: [/^@playwright\//, /^playwright(-core)?(\/|$)/] },
  },
  {
    // The recorder window: index.html and one script, which the engine
    // serves from the folder it is handed. Everything the script needs is
    // inside it, React and the channel's client included: nothing is left to
    // resolve where it is served.
    clean: false,
    inputOptions,
    dts: false,
    entry: { window: "src/app/main.tsx" },
    outDir: "dist/window",
    format: ["esm"],
    platform: "browser",
    outExtensions: () => ({ js: ".js" }),
    // Pick React's production build now.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    // Radix marks its modules "use client", which means nothing here.
    suppressWarnings: [/module level directive "use client"/],
    plugins: [windowCss(), bundledPackages()],
    // lucide-react has no exports map: its ES build keeps each icon apart,
    // so only those used stay.
    alias: { "lucide-react": "lucide-react/dist/esm/lucide-react.mjs" },
    deps: { alwaysBundle: [/.*/] },
    copy: [{ from: "src/app/index.html", to: "dist/window" }],
    minify: true,
  },
]);
