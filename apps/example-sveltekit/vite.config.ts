import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Ayme stays in every build: the Playwright suite runs against the production build.
  plugins: [sveltekit(), ayme({ include: true })],
});
