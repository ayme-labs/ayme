import { fileURLToPath, URL } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Certification fixture only. There is deliberately no webpack configuration or fallback.
export default function nextConfig(phase) {
  return {
    reactStrictMode: true,
    // Keep the dev check from overwriting the production build under test.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    turbopack: {
      root: fileURLToPath(new URL("../../", import.meta.url)),
      rules: {
        "*.ts": {
          condition: {
            all: [
              "browser",
              { not: "foreign" },
              { content: /@WebMCP|extends/ },
            ],
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
