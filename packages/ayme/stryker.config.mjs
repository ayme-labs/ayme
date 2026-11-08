import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

export default {
  ...defineStrykerConfig(),
  // Stryker would prepend `// @ts-nocheck` to every file in the sandbox, the
  // compiler's fixtures included, moving the source lines that its build
  // errors name. Vitest does not type-check, so nothing needs it.
  disableTypeChecks: false,
};
