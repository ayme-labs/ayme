import { fileURLToPath } from "node:url";
import { defineNuxtConfig } from "nuxt/config";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

const nitroProcessImport = "import process from 'node:process';";

export default defineNuxtConfig({
  compatibilityDate: "2026-09-11",
  ssr: true,
  devtools: { enabled: false },
  // Apply Ayme's build defines to its published modules in the SSR graph too.
  build: { transpile: ["@ayme-dev/ayme", "@ayme-dev/vue"] },
  nitro: {
    rollupConfig: {
      plugins: [
        {
          // Nitro prepends this import after Rollup assigns bundle names, so
          // alias it after rendering to avoid dependency name collisions.
          name: "alias-nitro-process-import",
          renderChunk: {
            order: "post",
            handler(code) {
              if (!code.startsWith(nitroProcessImport)) return null;
              const aliasedCode = code
                .replace(
                  nitroProcessImport,
                  "import _proces from 'node:process';"
                )
                .replace("env:process.env", "env:_proces.env");
              return { code: aliasedCode, map: null };
            },
          },
        },
      ],
    },
  },
  typescript: {
    tsConfig: { compilerOptions: { experimentalDecorators: true } },
  },
  vite: {
    // POMs live outside Nuxt's generated app TypeScript project.
    oxc: { decorator: { legacy: true } },
    plugins: [
      ayme({
        tsconfigPath: fileURLToPath(
          new URL("./tsconfig.pom.json", import.meta.url)
        ),
      }),
    ],
  },
});
