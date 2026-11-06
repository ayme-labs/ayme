import { vi } from "vitest";

import type {
  Ayme,
  AymeWebMcpPublicationStatus,
  Caller,
  Interaction,
  JsonValue,
  Run,
  ToolInfo,
  ToolRunOptions,
} from "@ayme-dev/ayme";

import type {
  AgentConnectionStatus,
  AgentConnectionStatusSource,
  AgentImageRun,
  AppProcessTool,
  AppProcessTools,
} from "@ayme-dev/ayme/internal";
import {
  createHighlights,
  createInspectorContract,
  type InspectorSession,
} from "@ayme-dev/ayme/inspector";

// Not the slice's index: the tests mock the runtime's internal entry while
// they load this, and the index would wait on that mock.
// eslint-disable-next-line no-restricted-imports
import { replaceInspectorTransport } from "../../shared/infrastructure/inspectorClient";

// One list until a test sets another, as the session keeps it until it changes.
const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
const listeners = new Set<(tools: readonly ToolInfo[]) => void>();
const processListeners = new Set<(tools: readonly AppProcessTool[]) => void>();
const connectionListeners = new Set<(status: AgentConnectionStatus) => void>();
const AGENT_OFF: AgentConnectionStatus = Object.freeze({ state: "off" });

/**
 * A stand-in for the document's Run log, as `ayme.runs` gives it: a Run is
 * listed when it starts and updated when it ends, and the listeners hear
 * the new list each time. Tests start Runs of other Callers on it, and
 * `newDocument()` empties it the way a reload does, its ids starting over.
 */
function fixtureRunLog() {
  let runs: readonly Run[] = Object.freeze([]);
  let nextId = 1;
  const listeners = new Set<(runs: readonly Run[]) => void>();
  const publish = (next: readonly Run[]) => {
    runs = Object.freeze(next);
    for (const listener of listeners) listener(runs);
  };
  const log = {
    list: () => runs,
    subscribe(listener: (runs: readonly Run[]) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /**
     * Starts a Run of `tool` for `by`, or a child Run of the Run whose id is
     * `parent`, listed as running. Returns its id, what records an
     * Interaction it performs, and what ends it: with its result, or with
     * its error text.
     */
    start(
      tool: string,
      input: JsonValue | undefined,
      by: Caller | { parent: string }
    ) {
      const id = String(nextId++);
      const startedAt = Date.now();
      publish([
        ...runs,
        {
          id,
          tool,
          ...(typeof by === "string" ? { by } : by),
          status: "running",
          startedAt,
          ...(input === undefined ? {} : { input }),
          interactions: [],
        },
      ]);
      const update = (change: (run: Run) => Run) =>
        publish(runs.map((run) => (run.id === id ? change(run) : run)));
      const end = (ended: Pick<Run, "status" | "result" | "error">) =>
        update((run) => ({
          ...run,
          ...ended,
          durationMs: Date.now() - startedAt,
        }));
      return {
        id,
        interact: (interaction: Interaction) =>
          update((run) => ({
            ...run,
            interactions: [...run.interactions, interaction],
          })),
        succeed: (result?: unknown) =>
          end({
            status: "succeeded",
            ...(result === undefined
              ? {}
              : { result: JSON.parse(JSON.stringify(result)) as JsonValue }),
          }),
        fail: (error: string) => end({ status: "failed", error }),
      };
    },
    /** Records `execute` as a Run, the way the runtime records a tool's run. */
    async record(
      tool: string,
      input: unknown,
      by: Caller,
      execute: () => Promise<unknown>
    ) {
      const run = log.start(tool, input as JsonValue, by);
      try {
        const result = await execute();
        run.succeed(result);
        return result;
      } catch (error) {
        // The runtime words a failure; the stand-in keeps its message.
        run.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    /** An empty log for the next document, as after a reload. */
    newDocument() {
      nextId = 1;
      publish([]);
    },
  };
  return log;
}

const runLog = fixtureRunLog();

// The agent's image Runs `ayme mcp` reports, as the runtime hears of them.
const imageRunListeners = new Set<(run: AgentImageRun) => void>();

/**
 * A stand-in for the started session, for tests that replace
 * `getStartedAyme` with it: they set its tools and publication status, mock
 * `tools.run`, and announce a change.
 */
export const startedAyme = {
  tools: {
    list: vi.fn((): readonly ToolInfo[] => NO_TOOLS),
    subscribe: (listener: (tools: readonly ToolInfo[]) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    run: vi.fn<(name: string, input: object) => Promise<unknown>>(),
  },
  webMCP: {
    publicationStatus: {
      state: "active",
      message: "",
    } as AymeWebMcpPublicationStatus,
    subscribe: () => () => {},
  },
  /**
   * The tools of the App Processes paired beside the page, as
   * `getAppProcessTools` gives them: tests set them, mock `run`, and
   * announce a change.
   */
  appProcessTools: {
    list: vi.fn((): readonly AppProcessTool[] => NO_PROCESS_TOOLS),
    subscribe: (listener: (tools: readonly AppProcessTool[]) => void) => {
      processListeners.add(listener);
      return () => void processListeners.delete(listener);
    },
    run: vi.fn<(name: string, input: unknown) => Promise<unknown>>(),
  },
  /**
   * Whether the page is connected to an agent, as
   * `getAgentConnectionStatus` gives it: tests set it and announce a
   * change.
   */
  agentConnection: AGENT_OFF as AgentConnectionStatus,
  /**
   * The document's Run log. `tools.run` and `appProcessTools.run`, as the
   * session gives them, record their Runs here for the Caller they name;
   * the mocks see the tool's name and input.
   */
  runs: runLog,
  /** Reports an agent's image Run, as the page client does. */
  reportAgentImageRun(run: AgentImageRun) {
    for (const listener of imageRunListeners) listener(run);
  },
  /** The locator a highlight of `ref` asks for. */
  locate: (() => ({
    highlight: async () => ({ dispose: async () => {} }),
  })) as (ref: string) => {
    highlight(options: {
      style: Record<string, string | number>;
    }): Promise<{ dispose(): Promise<void> }>;
  },
  /** Tells subscribers the tools or the status changed. */
  announce() {
    for (const listener of listeners) listener(startedAyme.tools.list());
    for (const listener of processListeners)
      listener(startedAyme.appProcessTools.list());
    for (const listener of connectionListeners)
      listener(startedAyme.agentConnection);
  },
  /** Back to no tools, an active publication and no listeners. */
  reset() {
    startedAyme.tools.list.mockReset().mockReturnValue(NO_TOOLS);
    startedAyme.tools.run.mockReset();
    startedAyme.appProcessTools.list
      .mockReset()
      .mockReturnValue(NO_PROCESS_TOOLS);
    startedAyme.appProcessTools.run.mockReset();
    processListeners.clear();
    startedAyme.webMCP.publicationStatus = { state: "active", message: "" };
    startedAyme.agentConnection = AGENT_OFF;
    connectionListeners.clear();
    listeners.clear();
    runLog.newDocument();
  },
};

const byOf = (options: ToolRunOptions | undefined) => options?.by ?? "app";

// The session and its App Process tools as the runtime gives them: each run
// is recorded in the Run log.
const session = {
  get webMCP() {
    return startedAyme.webMCP;
  },
  tools: {
    list: () => startedAyme.tools.list(),
    subscribe: startedAyme.tools.subscribe,
    run: (name: string, input: object, options?: ToolRunOptions) =>
      runLog.record(name, input, byOf(options), () =>
        startedAyme.tools.run(name, input)
      ),
  },
  runs: { list: runLog.list, subscribe: runLog.subscribe },
};
const sessionAppProcessTools: AppProcessTools = {
  list: () => startedAyme.appProcessTools.list(),
  subscribe: startedAyme.appProcessTools.subscribe,
  run: (name, input, options) =>
    runLog.record(name, input, byOf(options), () =>
      startedAyme.appProcessTools.run(name, input)
    ),
};

/** The stand-in as `getStartedAyme` returns it. */
export const asStartedAyme = () => session as unknown as Ayme;

/** The stand-in's App Process tools, as `getAppProcessTools` returns them. */
export const appProcessToolsOf = (): AppProcessTools => sessionAppProcessTools;

const sessionAgentConnection: AgentConnectionStatusSource = {
  get: () => startedAyme.agentConnection,
  subscribe(listener) {
    connectionListeners.add(listener);
    return () => void connectionListeners.delete(listener);
  },
};

/**
 * The stand-in's Agent Connection status, as `getAgentConnectionStatus`
 * returns it.
 */
export const agentConnectionOf = (): AgentConnectionStatusSource =>
  sessionAgentConnection;

// The Inspector reads the stand-in through the contract the runtime serves,
// built over it with the runtime's own service: so the lenses are tested
// against the same state, revisions and commands as on a real session.
replaceInspectorTransport(
  createInspectorContract({
    started: () => session as unknown as InspectorSession,
    subscribeToStarted: () => () => {},
    appProcessTools: () => sessionAppProcessTools,
    connectionStatus: () => sessionAgentConnection,
    subscribeToAgentImageRuns: (listener) => {
      imageRunListeners.add(listener);
      return () => void imageRunListeners.delete(listener);
    },
    highlights: createHighlights((ref) => startedAyme.locate(ref)),
    pick: async () => undefined,
  })
);
