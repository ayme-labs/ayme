import react from "@vitejs/plugin-react";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    react(),
    aymeWebMcp({
      inspector: mode !== "inspector-disabled",
      publish: mode !== "publication-disabled",
    }),
  ],
}));
