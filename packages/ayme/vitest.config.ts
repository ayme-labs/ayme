import { defineConfig } from "vitest/config";

import { inPageModule } from "./build/inPageModule.ts";

export default defineConfig({
  plugins: [inPageModule()],
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.ts"],
  },
});
