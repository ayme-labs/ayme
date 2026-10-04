import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  dts: true,
  entry: {
    // The `ayme` command, which runs in Node.
    cli: "src/cli.ts",
    // The page client, which runs in the browser.
    client: "src/client/index.ts",
  },
  format: ["esm"],
  // No module here runs code on import, so the client entry keeps none of
  // the server's imports that a slice's index.ts re-exports.
  treeshake: { moduleSideEffects: false },
});
