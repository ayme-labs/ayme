import { getPageContextTool } from "./pageContext";
import {
  type PublishedTool,
  type PublishedToolGroup,
  reportPublishedTools,
  resolvePublishedTools,
} from "./publishedTools";
import { RuntimeStateError } from "./errors";
import {
  subscribeToRegisteredPoms,
  probeRegisteredPomMembers,
} from "./registry";

/** The MCP tool-failure result a published tool returns instead of throwing. */
type ToolErrorResult = {
  content: [{ type: "text"; text: string }];
  isError: true;
};

/**
 * Return a thrown error as an MCP `isError` result. WebMCP drops the reason of
 * a rejected `execute`, so a published tool never throws. The text is the
 * error's full message, prefixed with its name unless that is plain "Error".
 */
export function withErrorResult<T extends { execute(input: unknown): unknown }>(
  tool: T
): Omit<T, "execute"> & { execute(input: unknown): Promise<unknown> } {
  return {
    ...tool,
    execute: async (input: unknown) => {
      try {
        return await tool.execute(input);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  };
}

function toolErrorResult(error: unknown): ToolErrorResult {
  return { content: [{ type: "text", text: errorText(error) }], isError: true };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

/**
 * A tool as WebMCP runs it for an agent: after a call that can change the
 * page, `settle` runs before the call resolves; a failure is an `isError`
 * result. `snapshot` only reads, so it does not settle.
 */
export function asAgentCall(tool: PublishedTool, settle: () => Promise<void>) {
  return withErrorResult(
    tool === getPageContextTool
      ? tool
      : {
          ...tool,
          execute: async (input: unknown) => {
            try {
              return await tool.execute(input);
            } finally {
              await settle();
            }
          },
        }
  );
}

/**
 * Run any live tool the way an agent's call runs, whether or not WebMCP
 * publication is active: the live tool, wrapped as publication wraps it.
 * Settling probes the Page Objects; a publication, if any, re-publishes from
 * that probe on its own. Rejects when no tool of that name is live.
 */
export function runTool(name: string, input: unknown): Promise<unknown> {
  let live: ReturnType<typeof resolvePublishedTools>;
  try {
    live = resolvePublishedTools();
  } catch (error) {
    return Promise.reject(error);
  }
  const entry = live.get(name);
  if (!entry)
    return Promise.reject(
      new RuntimeStateError(`The tool "${name}" is not live.`)
    );
  return asAgentCall(entry.tool, () =>
    // A failed probe does not change the call's own result, as for an agent.
    probeRegisteredPomMembers().catch(() => {})
  ).execute(input);
}

export type WebMcpDriver = Pick<
  NonNullable<typeof document.modelContext>,
  "registerTool"
>;

export type WebMcpRegistration = {
  message: string;
  dispose(): void;
};

export type WebMcpSynchronizationOptions = {
  signal?: AbortSignal;
  /** Prepended to every name the driver registers; the registry's are unprefixed. */
  toolNamePrefix?: string;
  onError?: (error: unknown) => void;
};

/**
 * Keep the MCP driver's tool set in sync with the live DOM. Publishes Ref
 * Tools, Page Object tools, and `goal` (when configured). After each
 * tool call the publication is re-settled so the agent sees current tools.
 * A published tool never throws: a failure is an `isError` result.
 */
export async function synchronizeWebMcpTools(
  driver: WebMcpDriver,
  options: WebMcpSynchronizationOptions = {}
): Promise<WebMcpRegistration> {
  const prefix = options.toolNamePrefix ?? "";
  type Registration = {
    tool: PublishedTool;
    group: PublishedToolGroup;
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
  let reported = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener("abort", dispose);
    unsubscribe();
    for (const registration of published.values())
      registration.controller.abort();
    published.clear();
    if (reported) reportPublishedTools([]);
  };

  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener("abort", dispose, { once: true });

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
    options.onError?.(error);
  };

  // A tool call resolves only once the published tools reflect the page it
  // changed, so an agent's next call sees the tools that are live now. The
  // called tool itself is the exception: if the call made it unavailable, it
  // is withdrawn just after the call (ADR-0020 does not cover this case). A probe that observes a change starts the
  // publication pass through the subscriber.
  const settle = () =>
    disposed
      ? Promise.resolve()
      : probeRegisteredPomMembers()
          .then(() => currentSync)
          .catch(failPublication);

  const trackCall = <T extends { execute(input: unknown): Promise<unknown> }>(
    registration: Registration,
    tool: T
  ): T => ({
    ...tool,
    execute: async (input: unknown) => {
      registration.runningCalls += 1;
      try {
        return await tool.execute(input);
      } finally {
        registration.runningCalls -= 1;
        if (!registration.runningCalls && registration.keptForCall) {
          registration.keptForCall = false;
          // A timer, so the driver has taken the result before the tool goes.
          setTimeout(() => void synchronize().catch(failPublication), 0);
        }
      }
    },
  });

  const publish = async () => {
    try {
      do {
        syncAgain = false;
        const resolved = resolvePublishedTools();
        for (const [name, registration] of published) {
          if (resolved.get(name)?.tool === registration.tool) continue;
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

        for (const [name, { tool, group }] of resolved) {
          if (disposed || published.has(name)) continue;
          const controller = new AbortController();
          const registration: Registration = {
            tool,
            group,
            controller,
            runningCalls: 0,
            keptForCall: false,
          };
          published.set(name, registration);
          try {
            await driver.registerTool(
              {
                ...trackCall(registration, asAgentCall(tool, settle)),
                name: prefix + name,
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
      // The Inspector reads the settled set, never one mid-pass.
      if (!disposed) {
        reported = true;
        reportPublishedTools([...published.values()]);
      }
    } finally {
      syncing = false;
    }
  };

  if (!disposed) {
    try {
      await probeRegisteredPomMembers();
      if (!disposed) {
        unsubscribe = subscribeToRegisteredPoms(() => {
          void synchronize().catch(failPublication);
        });
        await synchronize();
      }
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

export function waitForWebMcpDriver(timeoutMs = 2_000, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;

  return new Promise<WebMcpDriver | undefined>((resolve) => {
    let timer: number | undefined;
    const finish = (driver: WebMcpDriver | undefined) => {
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(driver);
    };
    const abort = () => finish(undefined);
    const check = () => {
      if (document.modelContext) {
        finish(document.modelContext);
        return;
      }
      if (Date.now() >= deadline) {
        finish(undefined);
        return;
      }
      timer = window.setTimeout(check, 50);
    };
    if (signal?.aborted) finish(undefined);
    else {
      signal?.addEventListener("abort", abort, { once: true });
      check();
    }
  });
}
