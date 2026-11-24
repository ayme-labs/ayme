import { configDefaults, defineConfig } from "vitest/config";

/** The compatibility suite, the stock adapter on stock Playwright: it
 * launches Chromium, so it runs on its own, with `pnpm test:compat`. */
export const compatTests = "src/**/*.compat.test.ts";

/** Measurements of how long the engine's own work takes on large inputs:
 * no tests, so they run on their own, by hand, with `pnpm test:timing`. */
export const timingTests = "src/**/*.timing.test.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, compatTests, timingTests],
  },
});
