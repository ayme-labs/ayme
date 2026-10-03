import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
export default defineConfig({
  plugins: [ayme({ inspector: false })],
  build: { minify: false },
  // Probe switch: bundle the whole server (React included) instead of Node loading
  // packages unbundled: React <17 CJS has no Node-detectable named exports.
  ssr: { noExternal: process.env.PROBE_SSR_NOEXTERNAL ? true : [] },
});
