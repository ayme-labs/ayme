import { fileURLToPath, URL } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Certification fixture only. There is deliberately no webpack configuration or fallback.
export default function nextConfig(phase) {
  return {
    reactStrictMode: true,
    // Keep the dev check from overwriting the production build under test.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Publication is a build policy (ADR-0016). Without Vite's define hook,
    // Next's own compile-time defines set Ayme's build constant in both graphs.
    compiler: { define: { __AYME_WEBMCP_PUBLISH__: true } },
    turbopack: {
      root: fileURLToPath(new URL("../../", import.meta.url)),
      rules: {
        "*.ts": {
          condition: {
            all: ["browser", { not: "foreign" }, { content: /@WebMCP/ }],
          },
          loaders: [
            {
              loader: "@ayme-dev/unplugin-webmcp/turbopack-loader",
              options: {
                tsconfigPath: fileURLToPath(
                  new URL("./tsconfig.pom.json", import.meta.url)
                ),
              },
            },
          ],
          as: "*.js",
        },
      },
    },
  };
}
