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
 * cursor its Change Record moves.
 */
export type RunContext = {
  readonly reader: Reader;
  /** Starts a child Run of this Run. */
  readonly run: StartChildRun;
};

/**
 * Package-internal: starts the live tool `name` as a child Run of the
 * current Run, inside its turn, after the child Runs it started before: it
 * never waits on the page's queue. Its Change Record moves `reader`'s
 * cursor, the parent Run's by default.
 */
export type StartChildRun = (
  name: string,
  input: unknown,
  reader?: Reader
) => Promise<unknown>;

/** Package-internal: a tool as a Run executes it. */
export type ExecutableTool<T = unknown> = {
  execute(input: unknown, context: RunContext): Promise<T>;
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

/** Package-internal: whose cursor a top-level Run for `by` moves. */
export function readerOf(by: Caller): Reader {
  return by === callers.webmcp ? "agent" : "app";
}

/**
 * Package-internal: a queue of Runs, a page's top-level Runs or one Run's
 * child Runs. Each Run's turn starts once the turn before it has ended,
 * whether that Run succeeded or failed. A top-level Run's turn is all of
 * `turn`: an action's settle included, a read's without one. A Run inside
 * another Run's turn must not take a turn on the queue that Run waits in:
 * it would wait behind the Run it is part of.
 */
export type RunQueue = <T>(turn: () => Promise<T>) => Promise<T>;

/** Package-internal: an empty `RunQueue`, one per page and one per Run's children. */
export function createRunQueue(): RunQueue {
  let last: Promise<unknown> = Promise.resolve();
  return (turn) => {
    const ran = last.then(turn);
    last = ran.catch(() => {});
    return ran;
  };
}

/**
 * Package-internal: execute `tool` for a top-level Run, then `settle`; a
 * child Run adds no settle wait of its own. The context's reader is the
 * Caller's (`readerOf`).
 */
export function executeTopLevelRun<T>(
  tool: ExecutableTool<T>,
  input: unknown,
  context: RunContext,
  settle: () => Promise<void>
): Promise<T> {
  return settledAfter(tool, () => tool.execute(input, context), settle);
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
