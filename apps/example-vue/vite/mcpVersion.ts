import { readFileSync } from "node:fs";

/**
 * The version of the installed `@ayme-dev/mcp`, which the agent prompt pins.
 * Read from its manifest at build time, so the prompt follows the package's
 * releases. The package's exports don't include its package.json.
 */
const mcpVersion = (
  JSON.parse(
    readFileSync(
      new URL("../node_modules/@ayme-dev/mcp/package.json", import.meta.url),
      "utf8"
    )
  ) as { version: string }
).version;

/** Vite's `define` for `__AYME_MCP_VERSION__`. */
export const mcpVersionDefine = {
  __AYME_MCP_VERSION__: JSON.stringify(mcpVersion),
};
