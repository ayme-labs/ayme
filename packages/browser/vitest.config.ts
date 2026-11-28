import { configDefaults, defineConfig } from "vitest/config";

/** The compatibility suite, this package on stock Playwright: it starts
 * Chromium, so it runs on its own, with `pnpm test:compat`. */
export const compatTests = "src/**/*.compat.test.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, compatTests],
  },
});
