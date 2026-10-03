import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    react(),
    ayme({
      inspector: mode !== "inspector-disabled",
    }),
  ],
}));
