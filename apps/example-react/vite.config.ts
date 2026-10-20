import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  // Ayme stays in every build: the Playwright suite runs against the production build.
  plugins: [react(), ayme({ include: true })],
});
