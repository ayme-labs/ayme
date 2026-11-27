import config from "@ayme-dev/eslint-config/base";

// formbricks/ is the Formbricks submodule, linted by its own upstream.
export default [{ ignores: ["formbricks/**"] }, ...config];
