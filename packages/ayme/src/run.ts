import { RuntimeStateError } from "./errors";
import type { Reader } from "./interactionHistory";
import { getPageContextTool } from "./pageContext";
import { isPeekTool } from "./peek";

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

/** How `ayme.tools.run` starts a Run. */
export type ToolRunOptions = {
  /** The Run's Caller; `"app"` when absent. */
  by?: Caller;
};

/**
 * Package-internal: what a tool's execution is handed. `reader` is whose
 * cursor its Change Record moves. A tool executed without one, as tests do,
 * reads as the agent.
 */
export type RunContext = { readonly reader: Reader };

/** Package-internal: a tool as a Run executes it. */
export type ExecutableTool<T = unknown> = {
  execute(input: unknown, context?: RunContext): Promise<T>;
};

/**
 * Package-internal: the Caller `options` names, `app` when it names none.
 * Throws `RuntimeStateError` for an empty name.
 */
export function callerOf(options: ToolRunOptions | undefined): Caller {
  const by = options?.by ?? callers.app;
  if (typeof by !== "string" || by === "")
    throw new RuntimeStateError(
      "A Run needs a Caller: pass a non-empty name as `by`, or leave it out to run as the app."
    );
  return by;
}

/**
 * Package-internal: the one path every tool execution takes, a top-level
 * Run's and a Goal Loop step's alike.
 */
export function executeTool<T>(
  tool: ExecutableTool<T>,
  input: unknown,
  reader: Reader
): Promise<T> {
  return tool.execute(input, { reader });
}

/**
 * Package-internal: run `tool` as a top-level Run for `by`, then `settle`.
 * A `webmcp` Run moves the agent's cursor; every other Caller's the app's.
 */
export function runTool<T>(
  tool: ExecutableTool<T>,
  input: unknown,
  by: Caller,
  settle: () => Promise<void>
): Promise<T> {
  const reader: Reader = by === callers.webmcp ? "agent" : "app";
  return settledAfter(tool, () => executeTool(tool, input, reader), settle);
}

/**
 * Run `call` of `tool`, then `settle` before resolving, unless the tool only
 * reads (`snapshot`, a Peek Tool) or its answer says a full page load
 * started: that answer goes out at once, before the document goes away.
 */
async function settledAfter<T>(
  tool: ExecutableTool<T>,
  call: () => Promise<T>,
  settle: () => Promise<void>
): Promise<T> {
  if ((tool as object) === getPageContextTool || isPeekTool(tool))
    return call();
  let result: T;
  try {
    result = await call();
  } catch (error) {
    await settle();
    throw error;
  }
  if (!startedFullLoad(result)) await settle();
  return result;
}

/** Whether an answer, an action result or a Handover, names a loading URL. */
function startedFullLoad(answer: unknown): boolean {
  return (
    typeof answer === "object" &&
    answer !== null &&
    typeof (answer as { loading?: unknown }).loading === "string"
  );
}
