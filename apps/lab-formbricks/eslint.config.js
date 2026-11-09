import config from "@ayme-dev/eslint-config/base";

// formbricks/ is the Formbricks submodule, linted by its own upstream;
// ayme mcp writes .ayme/init-script.js each time it starts.
export default [
  { ignores: ["formbricks/**", ".ayme/init-script.js"] },
  ...config,
];
