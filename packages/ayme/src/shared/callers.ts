/**
 * The names Ayme's own Callers start Runs under: the app's code by default,
 * an agent through WebMCP, an agent through the Ayme MCP server, and the
 * Inspector.
 */
export const callers = Object.freeze({
  app: "app",
  webmcp: "webmcp",
  aymeMcp: "ayme-mcp",
  inspector: "inspector",
} as const);

/** One of the built-in Caller names in `callers`. */
export type BuiltInCaller = (typeof callers)[keyof typeof callers];

/**
 * Whoever starts a top-level Run names itself: a built-in Caller name, or any
 * other non-empty string, in lowercase kebab-case by convention.
 */
export type Caller = BuiltInCaller | (string & {});
