import type { AgentImageRun } from "../tools/application";
import {
  type AgentConnectionStatus,
  type AppProcessTool,
  type InspectorAgentImageRun,
  type InspectorContract,
  type InspectorEvent,
  type InspectorHighlightLayer,
  type InspectorState,
  type JsonValue,
  type ToolInfo,
} from "../shared";
import type { InspectorPublication, InspectorRun } from "../shared";
import type { Ayme } from "./runtime";

/** The part of a started session the contract reads. */
export type InspectorSession = Pick<Ayme, "tools" | "runs" | "webMCP">;

/** What the contract needs of the runtime around it, each behind a port. */
export type InspectorContractPorts = {
  /** The started session, if any. */
  started(): InspectorSession | undefined;
  /** Calls `listener` after a session starts or stops. */
  subscribeToStarted(listener: () => void): () => void;
  appProcessTools(session: InspectorSession): {
    list(): readonly AppProcessTool[];
    subscribe(listener: () => void): () => void;
    run(
      name: string,
      input: unknown,
      options?: { by?: string }
    ): Promise<unknown>;
  };
  connectionStatus(session: InspectorSession): {
    get(): AgentConnectionStatus;
    subscribe(listener: () => void): () => void;
  };
  subscribeToAgentImageRuns(listener: (run: AgentImageRun) => void): () => void;
  highlights: {
    set(layer: InspectorHighlightLayer, refs: readonly string[]): Promise<void>;
  };
  /** Picks a ref among `refs`; none when `signal` aborts first or Esc cancels. */
  pick(
    refs: readonly string[],
    signal: AbortSignal
  ): Promise<string | undefined>;
};

const NO_SESSION: InspectorPublication = Object.freeze({
  state: "disposed",
  message: "No Ayme runtime session has started.",
});
const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
const NO_RUNS: readonly InspectorRun[] = Object.freeze([]);
const OFF: AgentConnectionStatus = Object.freeze({ state: "off" });

/**
 * The Inspector contract over the runtime's started session: the same reads
 * `ayme.tools.list()` and the Run log give, as one plain-data state with a
 * revision that rises on each change, and the Inspector's commands. Nothing
 * here is serialized: inline, the Inspector calls it directly.
 */
export function createInspectorContract(
  ports: InspectorContractPorts
): InspectorContract {
  let revision = 0;
  let last: readonly unknown[] = [];
  let lastState: InspectorState | undefined;
  const observers = new Set<Parameters<InspectorContract["subscribe"]>[0]>();
  const picks = new Map<string, AbortController>();

  /** The state now: the revision rises only when a part of it changed. */
  function read(): InspectorState {
    const session = ports.started();
    const processes = session && ports.appProcessTools(session);
    const connection = session && ports.connectionStatus(session);
    const tools = session ? session.tools.list() : NO_TOOLS;
    const appProcessTools = processes?.list() ?? NO_PROCESS_TOOLS;
    const publication = session?.webMCP.publicationStatus ?? NO_SESSION;
    const agentConnection = connection?.get() ?? OFF;
    const runs = session
      ? (session.runs.list() as readonly InspectorRun[])
      : NO_RUNS;
    const parts = [
      session,
      tools,
      appProcessTools,
      publication,
      agentConnection,
      runs,
    ];
    if (
      !lastState ||
      parts.length !== last.length ||
      parts.some((part, index) => part !== last[index])
    ) {
      last = parts;
      lastState = Object.freeze({
        revision: ++revision,
        tools,
        appProcessTools,
        publication,
        agentConnection,
        runs,
      });
    }
    return lastState;
  }

  const emit = (event: InspectorEvent) => {
    for (const observer of [...observers])
      try {
        observer.onEvent(event);
      } catch (error) {
        observer.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
  };
  const publish = () => {
    const before = lastState;
    const state = read();
    if (state !== before) emit({ type: "state", state });
  };

  // While anyone listens, follow the started session, across sessions.
  let unfollow = () => {};
  const followSession = () => {
    unfollow();
    const session = ports.started();
    if (!session) {
      unfollow = () => {};
      return;
    }
    const stops = [
      session.tools.subscribe(publish),
      session.runs.subscribe(publish),
      session.webMCP.subscribe(publish),
      ports.appProcessTools(session).subscribe(publish),
      ports.connectionStatus(session).subscribe(publish),
    ];
    unfollow = () => stops.forEach((stop) => stop());
  };
  let stopListening: (() => void) | undefined;
  const listen = () => {
    followSession();
    const stopStarted = ports.subscribeToStarted(() => {
      followSession();
      publish();
    });
    const stopImages = ports.subscribeToAgentImageRuns((run) =>
      emit({
        type: "agent-image-run",
        revision: read().revision,
        run: plainImageRun(run),
      })
    );
    stopListening = () => {
      stopStarted();
      stopImages();
      unfollow();
      unfollow = () => {};
    };
    // A state change between the last read and now is pushed at once.
    publish();
  };

  const answer = (extra: { ref?: string; error?: string } = {}) => ({
    state: read(),
    ...extra,
  });

  return {
    getState: async () => read(),
    subscribe(observer) {
      read();
      observers.add(observer);
      if (observers.size === 1) listen();
      return () => {
        if (!observers.delete(observer) || observers.size > 0) return;
        stopListening?.();
        stopListening = undefined;
      };
    },
    async runTool({ name, input, by }) {
      const session = ports.started();
      if (!session) return answer({ error: NO_SESSION.message });
      const processes = ports.appProcessTools(session);
      const options = by === undefined ? undefined : { by };
      try {
        if (processes.list().some((tool) => tool.name === name))
          await processes.run(name, input, options);
        else
          await (
            session.tools.run as (
              name: string,
              input: unknown,
              options?: { by?: string }
            ) => Promise<unknown>
          )(name, input, options);
      } catch (error) {
        // The log records the failed Run, which the panel shows.
        return answer({
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return answer();
    },
    async highlight({ layer, refs }) {
      await ports.highlights.set(layer, refs);
      return answer();
    },
    async pick({ id, refs }) {
      picks.get(id)?.abort();
      const controller = new AbortController();
      picks.set(id, controller);
      try {
        const ref = await ports.pick(refs, controller.signal);
        return answer(ref === undefined ? {} : { ref });
      } finally {
        if (picks.get(id) === controller) picks.delete(id);
      }
    },
    async cancelPick({ id }) {
      picks.get(id)?.abort();
      return answer();
    },
  };
}

/** What an agent's image Run reports, without the image's bytes. */
function plainImageRun({
  name,
  input,
  savedTo,
  startedAt,
  durationMs,
}: AgentImageRun): InspectorAgentImageRun {
  return {
    name,
    input: input as JsonValue,
    ...(savedTo === undefined ? {} : { savedTo }),
    startedAt,
    durationMs,
  };
}
