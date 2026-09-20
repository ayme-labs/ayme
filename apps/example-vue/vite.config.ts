import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig, loadEnv } from "vite";

import { decisionEndpointDev } from "./vite/decisionEndpoint.dev";

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), "");
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    plugins: [
      vue(),
      tailwindcss(),
      aymeWebMcp({
        inspector: mode !== "inspector-disabled",
        publish: mode !== "publication-disabled",
      }),
      decisionEndpointDev(),
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
