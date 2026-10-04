import config from "@ayme-dev/eslint-config/base";
import { plugin } from "@ayme-dev/eslint-config/testing-entries";

export default [
  ...config,
  // The builders define Playwright tests, so they may use the testing entry.
  {
    files: ["src/tests.ts"],
    rules: {
      [`${plugin}/no-restricted-imports`]: "off",
      [`${plugin}/no-restricted-syntax`]: "off",
    },
  },
];
