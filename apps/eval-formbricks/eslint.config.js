import config from "@ayme-dev/eslint-config/base";

// results/ holds run artifacts, some of them scripts the agent's browser ran.
export default [{ ignores: ["results/**"] }, ...config];
