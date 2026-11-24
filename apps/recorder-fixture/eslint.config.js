import config from "@ayme-dev/eslint-config/base";

export default [
  // `ayme mcp` writes the init script it serves Page Objects through, with
  // its port, each time it starts; git ignores it too.
  { ignores: [".ayme/init-script.js"] },
  ...config,
];
