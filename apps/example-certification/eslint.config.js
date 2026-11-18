import config from "@ayme-dev/eslint-config/base";
import { plugin } from "@ayme-dev/eslint-config/testing-entries";

export default [
  ...config,
  // The builders and the warm-up drive Playwright or e2e, so they may use
  // the testing entry.
  {
    files: ["src/tests.ts", "src/warmDevServer.ts", "src/e2e/tests.ts"],
    rules: {
      [`${plugin}/no-restricted-imports`]: "off",
      [`${plugin}/no-restricted-syntax`]: "off",
    },
  },
];
