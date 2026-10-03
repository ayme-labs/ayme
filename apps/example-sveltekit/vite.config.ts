import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // SvelteKit 2's tsconfig chain does not reach Vite 8's oxc, so POM
  // decorators are lowered here.
  oxc: { decorator: { legacy: true } },
  plugins: [sveltekit(), ayme()],
});
