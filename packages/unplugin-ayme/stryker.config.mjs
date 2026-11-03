import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

export default {
  ...defineStrykerConfig(),
  // Stryker would prepend `// @ts-nocheck` to every file in the sandbox,
  // fixtures included, moving the source lines that build errors name. Vitest
  // does not type-check, so nothing needs it.
  disableTypeChecks: false,
};
