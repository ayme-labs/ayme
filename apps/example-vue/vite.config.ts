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
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    plugins: [
      vue(),
      tailwindcss(),
      ayme(),
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
