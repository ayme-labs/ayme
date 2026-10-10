import type { WebMcpDriver } from "./driver";

/**
 * A tool of the session, by its unprefixed name, as `ayme.tools.list()`
 * reads it: `available` says whether a call can run it now. Publication
 * registers every listed tool, available or not; the session refuses a call
 * to an unavailable one with its reason (ADR-0035).
 */
export type WebMcpTool = Readonly<{
  name: string;
  description: string;
  inputSchema: object;
  group: string;
  available: boolean;
}>;

/** The session's tools, as publication reads and calls them. */
export type WebMcpToolSource = {
  /** Every tool of the session now; throws when they cannot be listed. */
  list(): readonly WebMcpTool[];
  /** Calls `listener` after the tools may have changed; returns what stops it. */
  subscribe(listener: () => void): () => void;
  /**
   * Runs an agent's call of a listed tool, by its unprefixed name. Resolves
   * once the page has settled after it, and the source has told its
   * listeners of any tool the call changed.
   */
  run(name: string, input: unknown): Promise<unknown>;
};

export type WebMcpRegistration = {
  message: string;
  dispose(): void;
};

type SynchronizationOptions = {
  signal: AbortSignal;
  /** Prepended to every name the driver registers. */
  toolNamePrefix?: string;
  onError(error: unknown): void;
};

/**
 * Return a thrown error as an MCP `isError` result. WebMCP drops the reason of
 * a rejected `execute`, so a published tool never throws. The text is the
 * error's full message, prefixed with its name unless that is plain "Error".
 */
async function asToolResult(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    return {
      content: [{ type: "text", text: errorText(error) }],
      isError: true,
    };
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

/**
 * Whether WebMCP publishes a tool: every listed one but a Peek Tool, which
 * reads app state for a coding agent while developing, and `screenshot`,
 * whose image result WebMCP cannot carry.
 */
const publishable = (tool: WebMcpTool) =>
  tool.group !== "peek" && tool.name !== "screenshot";

/** What makes a published tool stale: its description or schema changed. */
const versionOf = (tool: WebMcpTool) =>
  JSON.stringify([tool.description, tool.inputSchema]);

/**
 * Keep the driver's tool set in sync with the source's publishable tools. A
 * call of a published tool resolves only once the published set reflects the
 * page it changed, so an agent's next call sees the tools listed now; the
 * called tool itself is withdrawn just after its call, if the call made the
 * source stop listing it. A published tool never throws: a failure is an
 * `isError` result.
 */
export async function synchronizeWebMcpTools(
  driver: WebMcpDriver,
  tools: WebMcpToolSource,
  options: SynchronizationOptions
): Promise<WebMcpRegistration> {
  const { signal } = options;
  const prefix = options.toolNamePrefix ?? "";
  type Registration = {
    version: string;
    controller: AbortController;
    // Agents' calls of this tool still running, and whether a pass kept the
    // tool published only because one was.
    runningCalls: number;
    keptForCall: boolean;
  };
  const published = new Map<string, Registration>();
  let disposed = false;
  let syncing = false;
  let syncAgain = false;
  let currentSync = Promise.resolve();
  let unsubscribe = () => {};

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    unsubscribe();
    for (const registration of published.values())
      registration.controller.abort();
    published.clear();
  };

  if (signal.aborted) dispose();
  else signal.addEventListener("abort", dispose, { once: true });

  const synchronize = () => {
    // publish clears `syncing` in the same step as its last `syncAgain`
    // check, so a caller never joins a pass that will not run again.
    if (syncing) {
      syncAgain = true;
      return currentSync;
    }
    syncing = true;
    currentSync = publish();
    return currentSync;
  };

  const failPublication = (error: unknown) => {
    if (disposed) return;
    dispose();
    options.onError(error);
  };

  const call = async (
    name: string,
    registration: Registration,
    input: unknown
  ) => {
    registration.runningCalls += 1;
    try {
      return await tools.run(name, input);
    } finally {
      // Whether the call succeeded or failed, the source told its listeners
      // of what it changed, so the pass that publishes that has started.
      await currentSync.catch(failPublication);
      registration.runningCalls -= 1;
      if (!registration.runningCalls && registration.keptForCall) {
        registration.keptForCall = false;
        // A timer, so the driver has taken the result before the tool goes.
        setTimeout(() => void synchronize().catch(failPublication), 0);
      }
    }
  };

  const publish = async () => {
    try {
      do {
        syncAgain = false;
        const listed = new Map(
          tools
            .list()
            .filter(publishable)
            .map((tool) => [tool.name, tool])
        );
        for (const [name, registration] of published) {
          const tool = listed.get(name);
          if (tool && versionOf(tool) === registration.version) continue;
          // A driver may fail a running call once its tool is unregistered
          // (the WebMCP polyfill does), although the call goes on to succeed.
          // The pass after the call withdraws the tool.
          if (registration.runningCalls) {
            registration.keptForCall = true;
            continue;
          }
          registration.controller.abort();
          published.delete(name);
        }

        for (const [name, tool] of listed) {
          if (disposed || published.has(name)) continue;
          const controller = new AbortController();
          const registration: Registration = {
            version: versionOf(tool),
            controller,
            runningCalls: 0,
            keptForCall: false,
          };
          published.set(name, registration);
          try {
            await driver.registerTool(
              {
                name: prefix + name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                execute: (input: unknown) =>
                  asToolResult(() => call(name, registration, input)),
              },
              { signal: controller.signal }
            );
          } catch (error) {
            controller.abort();
            published.delete(name);
            throw error;
          }
        }
      } while (syncAgain && !disposed);
    } finally {
      syncing = false;
    }
  };

  if (!disposed) {
    try {
      unsubscribe = tools.subscribe(() => {
        void synchronize().catch(failPublication);
      });
      await synchronize();
    } catch (error) {
      dispose();
      throw error;
    }
  }

  return {
    message: `Registered ${published.size} WebMCP tools and watching for changes.`,
    dispose,
  };
}
