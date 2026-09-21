import type { RegisteredPomTool } from "./contracts";
import { getPursueGoalTool } from "./goalLoop";
import { getPageContextTool } from "./pageContext";
import { clickPageStateRefTool, fillPageStateRefTool } from "./refInteractions";
import {
  listRegisteredPomTools,
  subscribeToRegisteredPoms,
  probeRegisteredPomMembers,
} from "./registry";

type PublishedTool =
  | RegisteredPomTool
  | typeof getPageContextTool
  | typeof clickPageStateRefTool
  | typeof fillPageStateRefTool;

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
  onError?: (error: unknown) => void;
};

/**
 * Keep the MCP driver's tool set in sync with the live DOM. Publishes Ref
 * Tools, Page Object tools, and `pursue_goal` (when configured). After each
 * tool call the publication is re-settled so the agent sees current tools.
 */
export async function synchronizeWebMcpTools(
  driver: WebMcpDriver,
  options: WebMcpSynchronizationOptions = {}
): Promise<WebMcpRegistration> {
  const published = new Map<
    string,
    { tool: PublishedTool; controller: AbortController }
  >();
  let disposed = false;
  let syncing = false;
  let syncAgain = false;
  let currentSync = Promise.resolve();
  let unsubscribe = () => {};

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener("abort", dispose);
    unsubscribe();
    for (const registration of published.values())
      registration.controller.abort();
    published.clear();
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
  // changed, so an agent's next call sees the tools that are live now. A probe
  // that observes a change starts the publication pass through the subscriber.
  const withSettledPublication = (tool: PublishedTool): PublishedTool =>
    tool === getPageContextTool
      ? tool
      : {
          ...tool,
          execute: async (input: unknown) => {
            try {
              return await tool.execute(input);
            } finally {
              if (!disposed)
                await probeRegisteredPomMembers()
                  .then(() => currentSync)
                  .catch(failPublication);
            }
          },
        };

  const publish = async () => {
    try {
      do {
        syncAgain = false;
        const pursueGoal = getPursueGoalTool();
        const active = new Map<string, PublishedTool>([
          [getPageContextTool.name, getPageContextTool],
          [clickPageStateRefTool.name, clickPageStateRefTool],
          [fillPageStateRefTool.name, fillPageStateRefTool],
          ...listRegisteredPomTools().map((tool) => [tool.name, tool] as const),
          ...(pursueGoal
            ? ([[pursueGoal.name, pursueGoal]] as [string, PublishedTool][])
            : []),
        ]);

        for (const [name, registration] of published) {
          const tool = active.get(name);
          if (tool === registration.tool) continue;
          registration.controller.abort();
          published.delete(name);
        }

        for (const [name, tool] of active) {
          if (disposed || published.has(name)) continue;
          const controller = new AbortController();
          published.set(name, { tool, controller });
          try {
            await driver.registerTool(withSettledPublication(tool), {
              signal: controller.signal,
            });
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
