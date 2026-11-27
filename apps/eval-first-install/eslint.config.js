import config from "@ayme-dev/eslint-config/base";

// results/ holds run output; fixture/ is the worker's project and app, not this package's code.
export default [{ ignores: ["results/**", "fixture/**"] }, ...config];
