import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  // The `ayme-recorder` command, which runs in Node.
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
});
