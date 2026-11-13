import { configDefaults, defineConfig } from "vitest/config";

/** The recorded browser's contract on stock Playwright: it launches
 * Chromium, so it runs on its own, with `pnpm test:contract`. */
export const contractTests = "src/**/*.contract.test.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, contractTests],
  },
});
