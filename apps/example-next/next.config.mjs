import { fileURLToPath, URL } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Certification fixture only. There is deliberately no webpack configuration or fallback.
export default function nextConfig(phase) {
  // Ayme stays in every build: the Playwright suite runs against the production build.
  const include = true;
  return {
    reactStrictMode: true,
    // Keep the dev check from overwriting the production build under test.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    turbopack: {
      root: fileURLToPath(new URL("../../", import.meta.url)),
      // A build without Ayme points the runtime's two entries and the
      // framework package at their absent entries for the browser, because
      // a loader cannot alias.
      resolveAlias: include
        ? {}
        : {
            "@ayme-dev/ayme": { browser: "@ayme-dev/ayme/absent" },
            "@ayme-dev/ayme/internal": { browser: "@ayme-dev/ayme/absent" },
            "@ayme-dev/react": { browser: "@ayme-dev/react/absent" },
          },
      rules: {
        "*.ts": {
          condition: {
            all: ["browser", { not: "foreign" }, { content: /@ayme|extends/ }],
          },
          loaders: [
            {
              loader: "@ayme-dev/unplugin-ayme/turbopack-loader",
              options: {
                include,
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
