import { defineConfig } from "tsdown";

import { thirdPartyNotices } from "./thirdPartyNotices.config.ts";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  // The `ayme-recorder` command, which runs in Node.
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  // The bundle holds Effect, whose documentation comments are most of its
  // size and name paths of their own examples.
  minify: true,
  // The window's built files, which the engine serves from the folder beside
  // this command's file, and the in-page toolbar's script beside them.
  // Copied into the output folder, wherever that is, as its `window` and
  // `toolbar` folders.
  copy: ({ outDir }) => [
    { from: "../recorder-window/dist/window", to: outDir },
    { from: "../recorder-window/dist/toolbar", to: outDir },
  ],
  // The notices of the third-party code bundled into the command and the
  // window.
  plugins: [thirdPartyNotices()],
});
