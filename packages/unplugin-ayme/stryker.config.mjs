import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

export default {
  ...defineStrykerConfig(),
  // Stryker would prepend `// @ts-nocheck` to every file in the sandbox,
  // fixtures included, moving the source lines that build errors name. Vitest
  // does not type-check, so nothing needs it.
  disableTypeChecks: false,
  // Keeps the sandbox two levels below the repository root, like this
  // package, so `../../../playwright-range.json` still resolves in it.
  tempDirName: "../../.stryker-tmp",
};
