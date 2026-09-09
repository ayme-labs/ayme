import vue from "@vitejs/plugin-vue";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    vue(),
    aymeWebMcp({
      inspector: mode !== "inspector-disabled",
      publish: mode !== "publication-disabled",
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 4190,
    strictPort: true,
  },
}));
