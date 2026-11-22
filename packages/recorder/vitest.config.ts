import { configDefaults, defineConfig } from "vitest/config";

/** The compatibility suite, the stock adapter on stock Playwright: it
 * launches Chromium, so it runs on its own, with `pnpm test:compat`. */
export const compatTests = "src/**/*.compat.test.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, compatTests],
  },
});
