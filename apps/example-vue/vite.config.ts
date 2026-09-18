import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    vue(),
    tailwindcss(),
    aymeWebMcp({
      inspector: mode !== "inspector-disabled",
      publish: mode !== "publication-disabled",
    }),
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
}));
