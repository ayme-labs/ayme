import { defineConfig } from "vitest/config";

import { inspectorCss } from "./inspectorCss.config";

export default defineConfig({
  plugins: [inspectorCss()],
  test: { environment: "jsdom" },
});
