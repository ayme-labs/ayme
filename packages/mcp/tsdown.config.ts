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
    // An App Process's side of the Agent Connection, which runs in Node.
    process: "src/process/index.ts",
    // Test-only helpers (ADR-0026), which start the built `ayme` command.
    testing: "src/testing/index.ts",
  },
  format: ["esm"],
  // No module here runs code on import, so the client entry keeps none of
  // the server's imports that a slice's index.ts re-exports.
  treeshake: { moduleSideEffects: false },
});
