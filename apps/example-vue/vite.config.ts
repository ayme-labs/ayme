import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig, loadEnv } from "vite";

import { decisionEndpointDev } from "./vite/decisionEndpoint.dev";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    plugins: [
      vue(),
      tailwindcss(),
      ayme(),
      decisionEndpointDev(env.AYME_OPENROUTER_API_KEY),
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
