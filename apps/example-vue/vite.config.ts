import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

import { readDecisionProvider } from "./scripts/appEnvironment";
import { decisionEndpointDev } from "./vite/decisionEndpoint.dev";
import { mcpVersionDefine } from "./vite/mcpVersion";

export default defineConfig(({ mode }) => {
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    define: mcpVersionDefine,
    plugins: [
      vue(),
      tailwindcss(),
      ayme(),
      decisionEndpointDev(readDecisionProvider(mode)),
    ],
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
