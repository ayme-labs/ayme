import config from "@ayme-dev/eslint-config/base";
import { plugin } from "@ayme-dev/eslint-config/testing-entries";

export default [
  ...config,
  // The whole package is test code: its builders define Playwright tests.
  {
    rules: {
      [`${plugin}/no-restricted-imports`]: "off",
      [`${plugin}/no-restricted-syntax`]: "off",
    },
  },
];
