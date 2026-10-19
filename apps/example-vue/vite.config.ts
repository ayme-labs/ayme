import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig, loadEnv } from "vite";

import { readDecisionProvider } from "./scripts/appEnvironment";
import { decisionEndpointDev } from "./vite/decisionEndpoint.dev";
import { googleTagManager } from "./vite/googleTagManager";

export default defineConfig(({ command, mode }) => {
  // One lookup decides both whether the dev server mounts the Decision
  // Endpoint and whether the page turns the Goal Loop on.
  const decisionProvider =
    command === "serve" ? readDecisionProvider(mode) : undefined;
  // `vite build --mode without-ayme` is the one build without Ayme, written
  // next to `dist` for scripts/verify-browser-output.mjs to check; every
  // other build keeps Ayme, because the Playwright suites and the hosted
  // playground run against the production build.
  const withoutAyme = mode === "without-ayme";
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    build: { outDir: withoutAyme ? "dist-without-ayme" : "dist" },
    plugins: [
      vue(),
      tailwindcss(),
      ayme({ include: !withoutAyme }),
      decisionEndpointDev(decisionProvider),
      // Only the build ayme.dev serves at /playground/ sets VITE_GTM_ID.
      googleTagManager(loadEnv(mode, process.cwd(), "VITE_").VITE_GTM_ID),
    ],
    define: {
      "import.meta.env.AYME_DECISION_ENDPOINT": JSON.stringify(
        decisionProvider !== undefined
      ),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 4190,
      strictPort: true,
    },
  };
});
