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

// Test support, imported by tests only: it stands a session in (ADR-0057).
import {
  createHighlights,
  createInspectorContract,
  type InspectorSession,
} from "@ayme-dev/ayme/internal";
import {
  type InspectorLook,
  type InspectorPageObject,
  type InspectorRecordedPageState,
  type PomDefinition,
} from "@ayme-dev/ayme/inspector";

// Not shared's infrastructure front door: the tests mock the runtime's
// internal entry while they load this, and the front door would wait on that mock.
// eslint-disable-next-line no-restricted-imports
import { replaceInspectorTransport } from "../../src/shared/infrastructure/inspectorClient";

// One list until a test sets another, as the session keeps it until it changes.
const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const listeners = new Set<(tools: readonly ToolInfo[]) => void>();

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

/** A page as a test stands it in: elements by ref, and the registry's targets on them. */
export type PageFixture = {
  projected: InspectorLook["projected"];
  elementsByRef?: ReadonlyMap<string, Element>;
  targets?: readonly {
    path: string;
    locator: string;
    element: Element;
    aliases?: readonly string[];
  }[];
  elementToolTargets?: Readonly<Record<string, readonly string[]>>;
  rootedInstances?: Readonly<
    Record<
      string,
      readonly {
        id: string;
        element: Element;
        available: boolean;
        reason?: string;
      }[]
    >
  >;
};

/** The look a page fixture gives, with each element named by its ref. */
export function lookOf({
  projected,
  elementsByRef = new Map(),
  targets = [],
  elementToolTargets = {},
  rootedInstances = {},
}: PageFixture): InspectorLook {
  const refOf = (element: Element) => {
    const refs = [...elementsByRef]
      .filter(([, candidate]) => candidate === element)
      .map(([ref]) => ref);
    return refs.length === 1 ? refs[0] : undefined;
  };
  const plainTargets = targets.map(({ element, ...target }) => {
    const ref = refOf(element);
    return ref === undefined ? target : { ...target, ref };
  });
  const targetsByRef: Record<string, string[]> = {};
  for (const target of plainTargets)
    if ("ref" in target && target.ref !== undefined)
      targetsByRef[target.ref] = [
        ...(targetsByRef[target.ref] ?? []),
        target.path,
      ];
  return {
    projected,
    refs: [...elementsByRef.keys()],
    targets: plainTargets,
    targetsByRef,
    elementToolTargets,
    controls: {},
    rootedInstances: Object.fromEntries(
      Object.entries(rootedInstances).map(([name, instances]) => [
        name,
        instances.map(({ id, element, available, reason }) => {
          const ref = refOf(element);
          return {
            id,
            ...(ref === undefined ? {} : { ref }),
            available,
            ...(reason === undefined ? {} : { reason }),
          };
        }),
      ])
    ),
  };
}

/** The look a fresh stand-in gives: the page state of nothing. */
const EMPTY_LOOK: InspectorLook = Object.freeze({
  projected: { roots: [] },
  refs: [],
  targets: [],
  targetsByRef: {},
  elementToolTargets: {},
  controls: {},
  rootedInstances: {},
});

const registryListeners = new Set<() => void>();

/**
 * A stand-in for the started session, for tests that replace
 * `getStartedAyme` with it: they set its tools and publication status, mock
 * `tools.run`, and announce a change.
 */
export const startedAyme = {
  /** The registry's Page Objects and definitions, as the contract reads them. */
  registry: {
    pageObjects: [] as readonly InspectorPageObject[],
    pomDefinitions: [] as readonly PomDefinition[],
  },
  /**
   * What one unrecorded look at the page gives, as the contract's `look`
   * does: tests set it to the page state they stand in.
   */
  look: (async () => EMPTY_LOOK) as () => Promise<InspectorLook>,
  /**
   * The page state the runtime last recorded, as the contract reads it: none
   * until a test records one.
   */
  recordedPage: undefined as InspectorRecordedPageState | undefined,
  /** Whether the Inspector asked the stand-in's runtime for Demo Mode. */
  demo: false,
  /**
   * Stands in the page for one look: its projected state, and the elements
   * each ref names, as the runtime's look sees them. The look gives each
   * element's refs and targets as the contract states them, so tests write
   * elements and the stand-in names them.
   */
  setPage(page: PageFixture) {
    startedAyme.look = async () => lookOf(page);
  },
  /** Sets the registry, and tells the contract it changed. */
  setRegistry(registry: {
    pageObjects?: readonly InspectorPageObject[];
    pomDefinitions?: readonly PomDefinition[];
  }) {
    startedAyme.registry = {
      pageObjects: registry.pageObjects ?? [],
      pomDefinitions: registry.pomDefinitions ?? [],
    };
    for (const listener of registryListeners) listener();
  },
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
   * The document's Run log. `tools.run`, as the session gives it, records
   * its Runs here for the Caller it names;
   * the mocks see the tool's name and input.
   */
  runs: runLog,
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
  },
  /** Back to no tools, an active publication and no listeners. */
  reset() {
    startedAyme.registry = { pageObjects: [], pomDefinitions: [] };
    startedAyme.look = async () => EMPTY_LOOK;
    startedAyme.recordedPage = undefined;
    startedAyme.demo = false;
    startedAyme.tools.list.mockReset().mockReturnValue(NO_TOOLS);
    startedAyme.tools.run.mockReset();
    startedAyme.webMCP.publicationStatus = { state: "active", message: "" };
    listeners.clear();
    runLog.newDocument();
  },
};

const byOf = (options: ToolRunOptions | undefined) => options?.by ?? "app";

// The session as the runtime gives it: each run is recorded in the Run log.
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
/** The stand-in as `getStartedAyme` returns it. */
export const asStartedAyme = () => session as unknown as Ayme;

// The Inspector reads the stand-in through the contract the runtime serves,
// built over it with the runtime's own service: so the lenses are tested
// against the same state, revisions and commands as on a real session.
replaceInspectorTransport(
  createInspectorContract({
    registry: {
      pageObjects: () => startedAyme.registry.pageObjects,
      pomDefinitions: () => startedAyme.registry.pomDefinitions,
      subscribe: (listener) => {
        registryListeners.add(listener);
        return () => void registryListeners.delete(listener);
      },
    },
    look: () => startedAyme.look(),
    recordedPageState: async () => startedAyme.recordedPage,
    demo: (on) => void (startedAyme.demo = on),
    pomDefinitionText: () => "",
    started: () => session as unknown as InspectorSession,
    subscribeToStarted: () => () => {},
    highlights: createHighlights((ref) => startedAyme.locate(ref)),
    pick: async () => undefined,
  })
);
