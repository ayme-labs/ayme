import type { AriaRef } from "@ayme-dev/core/structural-observation";
import type { Locator, Page } from "@playwright/test";
import type {
  CallerAwarePomTool,
  PomRegistry,
} from "../page-objects/application";
import {
  constructPageObject,
  type PageObjectConstructor,
} from "../page-objects/application";
import { getPomDefinitionsOf } from "../page-objects/infrastructure";
import { requiredDescription } from "../page-objects/domain";
import {
  configureCustomToolsOf,
  configureRouterNavigateOf,
  routerNavigateOf,
} from "../tools/infrastructure";
import type { peeksOf } from "../tools/infrastructure";
import {
  getPageContextTool,
  peekToolName,
  recordAgentImageRun,
  type CustomTool,
  type RegisteredElementTool,
  type PeekRead,
  type PeekSide,
} from "../tools/application";
import {
  createAgentConnectionStatus,
  setAgentConnectionStatus,
} from "./agentConnectionStatus";
import { configureGoalLoopOf } from "../goal-loop/infrastructure";
import { type GoalLoopDecisionFunction } from "../goal-loop/application";
import { assertAvailable, type Cursor } from "../page-state/domain";
import {
  configurePageStateIgnoreOf,
  cursorsOf,
  geometryReach,
  type PageStateStore,
} from "../page-state/infrastructure";
import {
  type Navigation as PageNavigation,
  type Reach,
} from "../page-state/application";
import {
  listPeekToolInfo,
  listTools,
  resolveTools,
  configureStartedPageOf,
  type ToolInfo,
  type ToolSources,
} from "./toolResolution";
import type {
  loadAgentConnection,
  loadProcessConnection,
} from "./agentConnection";
import type { InspectorPort } from "@ayme-dev/mcp/client";
import type { loadInspector } from "./inspector";
import {
  callerOf,
  createRunQueue,
  executeTopLevelRun,
  runLogOf,
  type AymeRuns,
  type RunContext,
  type RunLog,
  type StartChildRun,
  type ToolRunOptions,
} from "../runs/application";
import { instrumentedPage } from "../runs/infrastructure";
import type { loadWebMcpPublication } from "./webMcp";
import {
  callers,
  checkedToolInput,
  RuntimeStateError,
  type AppProcessTool,
  type Caller,
  type ElementFilter,
  type FilterData,
  type NamedFilter,
} from "../shared";
import type { ToolInput, ToolResult } from "../tools/domain";
import { inspectorSetting } from "./runtimeOptions";

export type AymeWebMcpPublicationStatus = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;
export type AymePage = ConstructorParameters<PageObjectConstructor>[0];

/**
 * A runtime session's WebMCP publication: its status, a subscription to status
 * changes, and an explicit retry. The status is `disabled` while publication
 * is off.
 */
export type AymeWebMcp = {
  readonly publicationStatus: AymeWebMcpPublicationStatus;
  /** Calls `listener` with the new status after each change. */
  subscribe(
    listener: (status: AymeWebMcpPublicationStatus) => void
  ): () => void;
  retryPublication(): Promise<void>;
};

export type { ToolInfo } from "./publishedTools";

/** Every registered tool, by its unprefixed name, whether or not WebMCP publishes it. */
export type AymeTools = {
  /**
   * Every tool, in publication order, each with whether it is available
   * now. A Page Object Tool stays listed while its Page Object is
   * unavailable; a surface that offers only what can run filters on
   * `available`. The same array comes back until the list changes; empty
   * while the session is not started.
   */
  list(): readonly ToolInfo[];
  /**
   * Calls `listener` with the new list after it changes, including when a
   * tool's availability changes.
   */
  subscribe(listener: (tools: readonly ToolInfo[]) => void): () => void;
  /**
   * Starts a Run of an available tool for the Caller `by` names, `"app"`
   * by default: every Caller, WebMCP and the Ayme MCP server included,
   * starts its Runs here. Runs take turns, one at a time per page: an
   * action's turn ends once the page has settled, a read's without a settle
   * wait. Throws Ayme's errors, and `RuntimeStateError` for an empty `by`,
   * while the session is not started, when no tool has the name, or when
   * the tool is not available.
   */
  run<N extends string>(
    name: N,
    input: ToolInput<N>,
    options?: ToolRunOptions
  ): Promise<ToolResult<N>>;
};

/** The session's Page Objects: one instance per class. */
export type AymePom = {
  /**
   * The session's instance of `model`, created on first use. On the server,
   * an inert object with the model's prototype.
   */
  get<T extends object>(model: PageObjectConstructor<T>): T;
  /**
   * Counts a registration of `model` and returns its instance. Its tools are
   * listed while the session is started and the count is above zero. A
   * Page Object that reaches a different class with the same name as one
   * a registered Page Object reaches lists no tools, and the refusal is
   * logged to the console instead of thrown. It is registered once the
   * Page Object it clashes with is unregistered.
   */
  register<T extends object>(model: PageObjectConstructor<T>): T;
  /** Removes one registration of `model`. */
  unregister(model: PageObjectConstructor): void;
};

/** The runtime object application setup creates. */
export type Ayme = {
  readonly webMCP: AymeWebMcp;
  readonly tools: AymeTools;
  /**
   * The document's Run log: the newest 200 top-level Runs started through
   * `tools.run`, by any Caller, and the App Process tools run from the
   * page, each with the child Runs a tool started through the `run` in its
   * context, oldest first. A new document starts an empty one.
   */
  readonly runs: AymeRuns;
  readonly pom: AymePom;
  /**
   * Adds a Peek: `read` returns the values of state an agent can read, and
   * may be async. Its Peek Tool, `peek.<name>` (`peek.node.<name>` in a
   * Node process), reads every live instance
   * when called. There is one instance per (`name`, `id`): a later call with
   * the same id gives that instance the new `read`, and without an id a later
   * call replaces the earlier one. Returns what removes the instance. Throws
   * `RuntimeStateError` when `name` is empty, or when another tool
   * already uses the Peek Tool's name. Does nothing unless the session has
   * `agentConnection` on, or `inspector` in the browser.
   * @experimental
   */
  peek(read: PeekRead, name: string, id?: string): () => void;
  /**
   * Makes the session the owner of the place it runs and turns on what its
   * options ask for; returns the function that stops it. In the browser it
   * owns the document; in a Node process it owns the process, as its App
   * Process, which offers its Peek Tools alone and, with `agentConnection`,
   * pairs with the agent's Ayme MCP server beside the page. One session owns
   * each at a time: a second start while one is started throws
   * `RuntimeStateError` with `code: "active-owner"`. A session a framework
   * integration created to render on the server starts nothing.
   */
  start(): () => void;
};

/** The object form of the `inspector` option. */
export type InspectorOptions = {
  /**
   * Where the Inspector runs: in the page (`"inline"`, the default) or in a
   * window outside it that `ayme mcp` serves (`"external"`).
   */
  placement?: "inline" | "external";
  /** Asks for Demo Mode too, in either placement. Off by default. */
  demo?: boolean;
};

export type AymeOptions = {
  /**
   * Builds the browser Page the session drives. Called at most once, lazily,
   * on the session's first use in the browser; `createPage()` when absent.
   */
  pageFactory?: () => AymePage;
  /**
   * The elements an agent does not see: a CSS selector, which excludes each
   * matching element and everything under it, or a self-contained function
   * the page runs over each element (it cannot read variables from the code
   * around it: a function that does is rejected when the runtime starts).
   */
  ignore?: ElementFilter;
  customTools?: CustomTool[];
  /**
   * Page Objects registered for the session's lifetime, as one
   * `pom.register` each when the session is created.
   */
  pageObjects?: readonly PageObjectConstructor[];
  /** @experimental */
  goalLoop?: GoalLoopDecisionFunction;
  webMCP?: AymeWebMcpOptions;
  /**
   * Turns the Inspector on while the session is started in the browser. Off
   * unless set. `true` mounts it in the page, from the optional
   * `@ayme-dev/inspector` package, with no demo; `{ demo: true }` also
   * pauses before each action and shows a click cue, for every call, whoever
   * makes it. `{ placement: "external" }` mounts no panel: the page serves
   * the Inspector's contract over its Agent Connection (which it turns on),
   * and `ayme mcp` serves the Inspector in a window of its own; see
   * `ayme_inspect` and `ayme inspect`.
   */
  inspector?: boolean | InspectorOptions;
  /**
   * Connects the session to a coding agent's Ayme MCP server through the
   * optional `@ayme-dev/mcp` package while the session is started: in the
   * browser, the page, through its page client; in Node, the process, as an
   * App Process beside the page. Off unless set. An object turns it on and,
   * for an App Process, says where the server is.
   */
  agentConnection?: boolean | AgentConnectionOptions;
  /**
   * The application's router navigation. The `navigate` tool calls it with
   * the resolved URL of a page on the document's own origin instead of
   * loading a new document, so the router keeps its in-memory state.
   */
  navigate?: (url: string) => unknown;
};

/**
 * Where an App Process finds the agent's Ayme MCP server. Without either,
 * it pairs with the one server that answers on the ports from 9350 to 9365.
 * A page ignores them.
 */
export type AgentConnectionOptions = {
  /** A connect link from the agent's `ayme_connect`, which names one server. */
  link?: string;
  /** The one port to look for a server on, as for `ayme mcp --port`. */
  port?: number;
};

/** WebMCP publication, decided where the runtime starts (ADR-0030). */
export type AymeWebMcpOptions = {
  /** Publishes the tools through WebMCP. Off unless `true`. */
  enabled?: boolean;
  /**
   * Prepended to every published tool name; `""` by default. Applies at
   * publication only: the Goal Loop and the registry use unprefixed names.
   */
  toolNamePrefix?: string;
};
type Registration = {
  count: number;
  active?: { dispose(): void };
};

export { sameRuntimeOptions, snapshotRuntimeOptions } from "./runtimeOptions";

/** The names of the registered tools, available or not; none while they clash. */
function registeredToolNames(sources: ToolSources): Set<string> {
  try {
    return new Set(resolveTools({ peeks: false }, sources).keys());
  } catch {
    return new Set();
  }
}

// The key a session on the server stores its Runs under.
export const serverKey = {} as Page;

const noSuchTool = (name: string) =>
  new RuntimeStateError(`There is no tool "${name}".`);

// One App Process per Node process, whichever session and bundle start it.
const appProcessHolder = globalThis as typeof globalThis & {
  __aymeAppProcess?: object;
};

const renderSessions = new WeakSet<Ayme>();

/**
 * Marks `ayme` as a render session: one a framework integration created to
 * render on the server. Its `start()` starts nothing, so concurrent renders
 * share no owner and none claims the process.
 */
export function markRenderSession(ayme: Ayme): void {
  renderSessions.add(ayme);
}

const handedReaches = new WeakMap<Ayme, Reach>();

/**
 * Package-internal, for unit tests, which have no layout to measure: the
 * session `ayme` measures reach with `reach` from its next start, instead
 * of Chromium's geometry.
 */
export function measureReachWith(ayme: Ayme, reach: Reach): void {
  handedReaches.set(ayme, reach);
}

/**
 * Package-internal: the Reach the session `ayme` measures with, the one
 * place that picks it: the one a unit test handed it, else Chromium's
 * geometry, as for every session without one.
 */
export function sessionReach(ayme?: Ayme): Reach {
  return (ayme && handedReaches.get(ayme)) ?? geometryReach;
}

function createServerPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const prototype = (model as unknown as { prototype: object }).prototype;
  return Object.create(prototype) as T;
}

/** A tool an App Process paired beside the page offers. */
export type { AppProcessTool };

/**
 * The tools of the App Processes paired with the session's Agent
 * Connection, which its page client hears of from the agent's Ayme MCP
 * server, for the Inspector. None while no server is paired.
 */
export type AppProcessTools = {
  /** The same array comes back until the list changes. */
  list(): readonly AppProcessTool[];
  /** Calls `listener` with the new list after each change. */
  subscribe(listener: (tools: readonly AppProcessTool[]) => void): () => void;
  /**
   * Runs one in its App Process, through the agent's Ayme MCP server, and
   * records it as a Run in the page's Run log for the Caller `by` names,
   * `"app"` by default. It acts on no page, so it takes no turn on the
   * page's queue and has no Interactions. Throws its error, or when no
   * server is paired.
   */
  run(name: string, input: unknown, options?: ToolRunOptions): Promise<unknown>;
};

const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
export const appProcessToolsBySession = new WeakMap<Ayme, AppProcessTools>();

/**
 * The session's App Process tools: those of the page client it follows,
 * and none while it follows none.
 */
export function createAppProcessTools(runLog: () => RunLog) {
  let followed: AppProcessTools | undefined;
  let unfollow = () => {};
  const listeners = new Set<(tools: readonly AppProcessTool[]) => void>();
  const list = () => followed?.list() ?? NO_PROCESS_TOOLS;
  const announce = () => {
    const tools = list();
    for (const listener of listeners) listener(tools);
  };
  const tools: AppProcessTools = {
    list,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(name, input, options) {
      const by = callerOf(options);
      const paired = followed;
      return runLog().record(
        name,
        input,
        { by },
        () => {
          if (!paired)
            throw new RuntimeStateError(
              "No Ayme MCP server is paired with this page."
            );
          return paired.run(name, input);
        },
        { offPage: true }
      );
    },
  };
  return {
    tools,
    /** Follows the page client's App Process tools, or none. */
    follow(next: AppProcessTools | undefined) {
      unfollow();
      const before = list();
      followed = next;
      unfollow = next?.subscribe(announce) ?? (() => {});
      if (list() !== before) announce();
    },
  };
}

let started: Ayme | undefined;
const startedListeners = new Set<(ayme: Ayme | undefined) => void>();

function setStarted(ayme: Ayme | undefined) {
  started = ayme;
  for (const listener of startedListeners) listener(ayme);
}

/** The session started in this document, if any, for the Inspector and the Vue integration. */
export function getStartedAyme(): Ayme | undefined {
  return started;
}

/** Calls `listener` with the started session, or none, after a session starts or stops. */
export function subscribeToStartedAyme(
  listener: (ayme: Ayme | undefined) => void
) {
  startedListeners.add(listener);
  return () => {
    startedListeners.delete(listener);
  };
}

const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);

/** A tool as Ayme MCP lists it. */
type AymeMcpTool = ToolInfo & { description?: string };

/**
 * A tool as Ayme MCP lists it: its Agent Description as its description,
 * and none when the tool says nothing beyond its name and schema, which MCP
 * allows.
 */
function forAymeMcp(tool: ToolInfo): AymeMcpTool {
  return tool.agentDescription === undefined
    ? tool
    : { ...tool, description: tool.agentDescription };
}

/**
 * Where a runtime session runs (ADR-0049): the document of the browser, over
 * Playwright Lite, or a real Playwright Page a Node host was handed. The
 * session code is the same; the target is how it reaches its Page, and
 * everything a session keeps is keyed by that Page.
 */
export type SessionTarget = {
  readonly kind: "browser" | "playwright";
  /** The Page the session's stores are keyed by, read when needed: a server renders without one. */
  key(): Page;
  /** The Page the Page Objects are built on and the Runs act on, before the Runs' instrumentation. */
  rawPage(): Page;
  /** The Page State Session and captures of the key's page. */
  pageState(): PageStateStore;
  /** The Page Object registry of the key's page. */
  registry(): PomRegistry;
  /** How a Run moves the page and tells where it is. */
  navigation(): PageNavigation;
  /** The Peeks the session keeps; none for a session that offers none. */
  peeks(): ReturnType<typeof peeksOf> | undefined;
  /** Where the session's tools come from. */
  readonly toolSources: ToolSources;
  /** Makes the session the registry's owner; throws while another is. */
  claim(page: Page): { dispose(): void };
  /**
   * Checks the options' filters as the page runs them, and registers the
   * Custom Tools: what `start()` configures. Throws `ToolInputError` when
   * the page cannot run a filter.
   */
  prepare(options: AymeOptions): PreparedOptions;
  /** The ref the session's latest page state gave the element a Locator matches. */
  latestRefOf(locator: Locator): Promise<AriaRef | undefined>;
  /**
   * Lets the session's Pages pace and cue each call while anyone asks for
   * Demo Mode (`demo` is this session's own `inspector` option), until
   * `signal` aborts. A Node host has none.
   */
  feedback?(demo: boolean, signal: AbortSignal): void;
  /**
   * What only the browser runtime has: the optional WebMCP, Inspector and
   * Agent Connection packages' loaders.
   */
  readonly surfaces?: {
    loadWebMcpPublication: typeof loadWebMcpPublication;
    loadInspector: typeof loadInspector;
    loadAgentConnection: typeof loadAgentConnection;
    loadProcessConnection: typeof loadProcessConnection;
    /**
     * Publishes the runtime's Inspector contract in the document's slot, for
     * an inline Inspector mounted by this session or by hand.
     */
    publishInspectorContract(): void;
    /** The contract an Inspector in another window reads, as plain data. */
    loadExternalInspectorPort(): Promise<InspectorPort | undefined>;
  };
};

/** What a session configures on start: its checked filters and registered Custom Tools. */
export type PreparedOptions = {
  ignore: FilterData | undefined;
  customTools: readonly RegisteredElementTool[] | undefined;
  customFilters: readonly NamedFilter[];
};

/**
 * The runtime session over `target`: the browser's, or a Node host's over a
 * Playwright Page.
 */
export function createAymeOn(
  target: SessionTarget,
  options: AymeOptions = {}
): Ayme {
  const onServer = () =>
    target.kind === "browser" && typeof window === "undefined";
  const surfaces = target.surfaces;
  const runLog = () => runLogOf(target.key());
  const sources = target.toolSources;
  let resolvedPage: AymePage | undefined;
  const getPage = () =>
    (resolvedPage ??= instrumentedPage(
      target.rawPage(),
      runLog().interact,
      target.latestRefOf
    ));
  // Publication is decided once, when the session is created.
  const enabled = options.webMCP?.enabled === true;
  // Peeks reach coding agents and the Inspector only (ADR-0034). The
  // Inspector mounts only in the browser, so in Node only the Agent
  // Connection turns them on.
  const peeks =
    Boolean(options.agentConnection) ||
    (inspectorSetting(options).placement !== "off" && !onServer());
  const initialStatus: AymeWebMcpPublicationStatus = {
    state: enabled ? "waiting" : "disabled",
    message: enabled
      ? "Waiting for the WebMCP driver."
      : "WebMCP publication is disabled.",
  };
  let status = Object.freeze(initialStatus);
  const subscribers = new Set<(status: AymeWebMcpPublicationStatus) => void>();
  const instances = new Map<PageObjectConstructor, object>();
  const registrations = new Map<PageObjectConstructor, Registration>();
  let tools = NO_TOOLS;
  let toolsKey = "[]";
  const toolListeners = new Set<(tools: readonly ToolInfo[]) => void>();
  let unsubscribeFromPoms: (() => void) | undefined;
  let unsubscribeFromPeeks: (() => void) | undefined;
  let owner: { dispose(): void } | undefined;
  // The Reach the started session measures with, picked on start.
  let reach: Reach = geometryReach;
  // The session while it runs the process's App Process, which has no
  // page: it offers its Peek Tools only.
  let inProcess: { stop(): void } | undefined;
  let controller: AbortController | undefined;
  // The started session's WebMCP publication; while its package loads, the
  // attempt that starts it and the retry that waits for that attempt.
  let publication: { retry(): Promise<void> } | undefined;
  let loading: Promise<typeof publication> | undefined;
  let retryingLoad: Promise<void> | undefined;
  const appProcessTools = createAppProcessTools(runLog);
  const agentConnectionStatus = createAgentConnectionStatus(
    Boolean(options.agentConnection) && !onServer()
  );
  // One top-level Run at a time on this page, whoever its Caller.
  const takeTurn = createRunQueue();

  const setStatus = (next: AymeWebMcpPublicationStatus) => {
    status = Object.freeze(next);
    for (const listener of subscribers) listener(status);
  };
  const refreshTools = () => {
    const next = owner
      ? listTools({ peeks }, sources)
      : inProcess && peeks
        ? listPeekToolInfo(sources)
        : NO_TOOLS;
    const key = JSON.stringify(next);
    if (key === toolsKey) return;
    tools = next;
    toolsKey = key;
    for (const listener of toolListeners) listener(tools);
  };
  /**
   * The session's tools as the `@ayme-dev/webmcp` package reaches them, its
   * calls as `webmcp` Runs. The package decides which of them it publishes.
   */
  const webMcpTools = {
    list: () =>
      ayme.tools.list().map((tool) => ({
        ...tool,
        description: requiredDescription(tool),
      })),
    subscribe: (listener: () => void) => ayme.tools.subscribe(listener),
    run: (name: string, input: unknown) =>
      ayme.tools.run(name, input as never, { by: callers.webmcp }),
  };

  /**
   * Loads the WebMCP package and starts publication, until `signal` aborts,
   * once a probe has made the Page Objects' tools current. Failing to load or
   * start is a failed publication, which a retry starts again.
   */
  function startPublication(signal: AbortSignal) {
    const attempt: Promise<typeof publication> = Promise.all([
      surfaces!.loadWebMcpPublication(),
      target.registry().probeRegisteredPomMembers(),
    ])
      .then(([{ startWebMcpPublication }]) => {
        if (signal.aborted) return undefined;
        publication = startWebMcpPublication(webMcpTools, {
          toolNamePrefix: options.webMCP?.toolNamePrefix,
          signal,
          onStatus: setStatus,
        });
        return publication;
      })
      .catch((error: unknown) => {
        if (signal.aborted) return undefined;
        setStatus({
          state: "failed",
          message: `WebMCP publication failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return undefined;
      })
      .finally(() => {
        if (loading === attempt) loading = undefined;
      });
    loading = attempt;
    return attempt;
  }

  function retryPublication(): Promise<void> {
    if (!enabled || !owner) return Promise.resolve();
    if (publication) return publication.retry();
    if (!loading) setStatus(initialStatus);
    retryingLoad ??= (loading ?? startPublication(controller!.signal))
      .then((started) => started?.retry())
      .finally(() => {
        retryingLoad = undefined;
      });
    return retryingLoad;
  }

  function stop() {
    if (!owner) return;
    controller?.abort();
    publication = undefined;
    loading = undefined;
    retryingLoad = undefined;
    unsubscribeFromPoms?.();
    unsubscribeFromPoms = undefined;
    unsubscribeFromPeeks?.();
    unsubscribeFromPeeks = undefined;
    for (const registration of registrations.values()) {
      registration.active?.dispose();
      registration.active = undefined;
    }
    owner.dispose();
    owner = undefined;
    const key = target.key();
    configureStartedPageOf(key, undefined);
    configurePageStateIgnoreOf(key, undefined);
    configureCustomToolsOf(key, undefined, undefined);
    configureGoalLoopOf(key, undefined);
    configureRouterNavigateOf(key, undefined);
    if (started === ayme) setStarted(undefined);
    refreshTools();
    setStatus({ state: "disposed", message: "The Ayme runtime was disposed." });
  }

  const webMCP: AymeWebMcp = {
    get publicationStatus() {
      return status;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    retryPublication,
  };

  async function run(
    name: string,
    input: unknown,
    options?: ToolRunOptions
  ): Promise<unknown> {
    return queueTopLevelRun(name, input, callerOf(options));
  }

  /**
   * Queues a top-level Run of the tool `name` for `by`, which runs in
   * its turn on the page's queue. After an action, within the Run's turn,
   * the Page Objects are probed, so the tools' availability is current and
   * `tools.subscribe` listeners have heard of any change. `name` is resolved
   * when the turn starts, against the tools available then.
   */
  function queueTopLevelRun(
    name: string,
    input: unknown,
    by: Caller
  ): Promise<unknown> {
    return takeTurn(() =>
      recordTopLevelRun(name, input, by, () =>
        target
          .registry()
          .probeRegisteredPomMembers()
          .catch(() => {})
      )
    );
  }

  /**
   * Records a top-level Run of the tool `name` for `by` in the log and
   * executes it, in its turn. A session that runs an App Process keeps no
   * log: it runs its Peek Tools only.
   */
  async function recordTopLevelRun(
    name: string,
    input: unknown,
    by: Caller,
    settle: () => Promise<void>
  ): Promise<unknown> {
    if (inProcess) {
      // The Peek registry is shared by the process, so a session without
      // Peeks runs none another session added.
      const peekTool = peeks
        ? sources.peekTools().find((tool) => tool.name === name)
        : undefined;
      if (!peekTool) throw noSuchTool(name);
      // A read: it moves no cursor and adds no settle wait.
      return peekTool.execute(checkedToolInput(peekTool.inputSchema, input));
    }
    const cursor = cursorsOf(target.key()).of(by);
    return runLog().record(name, input, { by }, (id) => {
      const { tool, checkedInput } = lookUpRun(name, input);
      return executeTopLevelRun(
        {
          reads:
            tool === getPageContextTool ||
            (target.peeks()?.isPeekTool(tool) ?? false),
        },
        () =>
          executeWithChildRuns(id, cursor, (context) =>
            tool.execute(checkedInput, context)
          ),
        settle
      );
    });
  }

  /**
   * Looks up the tool `name` for a Run and checks the Run's `input` against
   * the tool's input schema, missing input as `{}`, before it asks whether
   * the tool is available: what is wrong with an input does not depend on
   * the page. Throws inside the Run that asked, so the log records that Run
   * as failed.
   */
  function lookUpRun(name: string, input: unknown) {
    if (!owner)
      throw new RuntimeStateError(
        `Cannot run the tool "${name}": the Ayme runtime session is not started.`
      );
    const entry = resolveTools({ peeks }, sources).get(name);
    if (!entry) throw noSuchTool(name);
    const checkedInput = checkedToolInput(entry.tool.inputSchema, input);
    if (!(
      entry.group === "pageObject" && (entry.tool as CallerAwarePomTool).rooted
    ))
      assertAvailable(name, entry);
    return { tool: entry.tool, checkedInput };
  }

  /**
   * Executes the Run `id` with a context whose `run` starts its child Runs,
   * and ends once every child Run it started has ended, even when it fails
   * first, so no child outlives its parent's turn. Each child runs the available
   * tool it names inside the parent's turn, never on the page's queue, and
   * starts its own children the same way. The parent's children run one
   * after the other, in the order it starts them, so two started together
   * never act on the page at once. Like a Goal Loop step before it, a child
   * Run adds no settle wait of its own; the parent's turn ends with the
   * parent's. A child Run reads from and moves its parent's cursor unless
   * the parent hands it another, as the goal Run hands its steps its fork.
   */
  async function executeWithChildRuns<T>(
    id: string,
    cursor: Cursor,
    execute: (context: RunContext) => Promise<T>
  ): Promise<T> {
    const routerNavigate = routerNavigateOf(target.key());
    const takeChildTurn = createRunQueue();
    const run: StartChildRun = (name, input, childCursor = cursor) =>
      takeChildTurn(() =>
        runLog().record(name, input, { parent: id }, (childId) =>
          executeWithChildRuns(childId, childCursor, (context) => {
            const { tool, checkedInput } = lookUpRun(name, input);
            return tool.execute(checkedInput, context);
          })
        )
      );
    try {
      return await execute({
        cursor,
        run,
        page: getPage(),
        navigation: target.navigation(),
        ...(routerNavigate ? { routerNavigate } : {}),
        pomDefinitions: (...names) =>
          getPomDefinitionsOf(target.registry(), ...names),
        pageStateSession: target.pageState().session,
        reach,
      });
    } finally {
      // A turn taken now starts once every child started so far has ended.
      await takeChildTurn(async () => {});
    }
  }

  /**
   * The session's tools as the Ayme MCP server's client reaches them: its
   * Runs are `ayme-mcp`'s, so `@ayme-dev/mcp` names no Caller.
   */
  const aymeMcpTools = {
    list: () => ayme.tools.list().map(forAymeMcp),
    subscribe: (listener: (tools: readonly AymeMcpTool[]) => void) =>
      ayme.tools.subscribe((tools) => listener(tools.map(forAymeMcp))),
    run: (name: string, input: unknown) =>
      ayme.tools.run(name, input as never, { by: callers.aymeMcp }),
  };

  const pom: AymePom = {
    get<T extends object>(model: PageObjectConstructor<T>): T {
      let instance = instances.get(model) as T | undefined;
      if (!instance) {
        // Server rendering gets an inert Page Object and never runs the
        // factory; it is still the session's one instance of the class.
        instance = onServer()
          ? createServerPageObject(model)
          : constructPageObject(model, getPage());
        instances.set(model, instance);
      }
      return instance;
    },
    register<T extends object>(model: PageObjectConstructor<T>): T {
      const instance = pom.get(model);
      if (onServer()) return instance;
      const registration = registrations.get(model) ?? { count: 0 };
      if (owner && !registration.active)
        registration.active = target
          .registry()
          .registerPageObject(model, instance);
      registration.count += 1;
      registrations.set(model, registration);
      return instance;
    },
    unregister(model) {
      const registration = registrations.get(model);
      if (!registration) return;
      registration.count -= 1;
      if (registration.count > 0) return;
      registration.active?.dispose();
      registrations.delete(model);
    },
  };
  for (const model of options.pageObjects ?? []) pom.register(model);

  const ayme: Ayme = {
    webMCP,
    tools: {
      list: () => tools,
      subscribe(listener) {
        toolListeners.add(listener);
        return () => {
          toolListeners.delete(listener);
        };
      },
      run: run as AymeTools["run"],
    },
    runs: {
      list: () => runLog().list(),
      subscribe: (listener) => runLog().subscribe(listener),
    },
    pom,
    peek(read, name, id) {
      if (typeof name !== "string" || name === "")
        throw new RuntimeStateError("A Peek needs a name.");
      if (!peeks) return () => {};
      // Node is an App Process's side.
      const side: PeekSide = onServer() ? "node" : "browser";
      const toolName = peekToolName(side, name);
      if (registeredToolNames(sources).has(toolName))
        throw new RuntimeStateError(
          `Cannot add the Peek "${name}": another tool already uses the name ${toolName}.`
        );
      return target.peeks()!.addPeek(side, read, name, id);
    },
    start() {
      if (renderSessions.has(ayme)) return () => {};
      if (onServer()) return startInProcess();
      if (owner)
        throw new RuntimeStateError(
          "The Ayme runtime already has an active owner.",
          { code: "active-owner" }
        );
      // Checked before anything starts: a filter the page cannot run throws here.
      const prepared = target.prepare(options);
      const key = target.key();
      owner = target.claim(getPage());
      reach = sessionReach(ayme);
      configureStartedPageOf(key, { page: getPage(), reach });
      // The page's interaction history starts with its first Visit.
      void target.pageState().session.history;
      configurePageStateIgnoreOf(key, prepared.ignore);
      configureCustomToolsOf(key, prepared.customTools, prepared.customFilters);
      configureGoalLoopOf(key, options.goalLoop);
      configureRouterNavigateOf(key, options.navigate);
      controller = new AbortController();
      try {
        const registry = target.registry();
        for (const [model, registration] of registrations)
          registration.active = registry.registerPageObject(
            model,
            pom.get(model)
          );
        unsubscribeFromPoms = registry.subscribeToRegisteredPoms(refreshTools);
        if (peeks)
          unsubscribeFromPeeks = target
            .peeks()!
            .subscribeToPeekTools(refreshTools);
        refreshTools();
        setStatus(initialStatus);
        if (target.kind === "browser") setStarted(ayme);
        if (enabled && surfaces) startPublication(controller.signal);
        const inspector = inspectorSetting(options);
        target.feedback?.(inspector.demo, controller.signal);
        // The inline Inspector, mounted by this session or by hand, reads the
        // runtime's contract from the slot the session publishes it in.
        surfaces?.publishInspectorContract();
        if (inspector.placement === "inline" && surfaces)
          mountInspectorUntil(surfaces.loadInspector, controller.signal);
        // An Inspector outside the page reaches it over the Agent Connection.
        const external = inspector.placement === "external";
        if ((options.agentConnection || external) && surfaces) {
          const signal = controller.signal;
          startAgentConnectionUntil(
            signal,
            () =>
              Promise.all([
                surfaces.loadAgentConnection(),
                external ? surfaces.loadExternalInspectorPort() : undefined,
              ]).then(([{ startAgentConnection }, inspectorPort]) => () => {
                const connection = startAgentConnection({
                  tools: aymeMcpTools,
                  recordAgentImage: recordAgentImageRun,
                  inspector: inspectorPort,
                });
                // A page client from before App Processes hands over none.
                appProcessTools.follow(connection.processTools);
                agentConnectionStatus.follow(connection.status);
                signal.addEventListener(
                  "abort",
                  () => {
                    appProcessTools.follow(undefined);
                    agentConnectionStatus.follow(undefined);
                  },
                  { once: true }
                );
                return connection;
              }),
            () => {
              agentConnectionStatus.failed();
              signal.addEventListener(
                "abort",
                () => agentConnectionStatus.follow(undefined),
                { once: true }
              );
            }
          );
        }
      } catch (error) {
        stop();
        throw error;
      }
      const startedOwner = owner;
      return () => {
        if (owner === startedOwner) stop();
      };
    },
  };

  /**
   * Claims the Node process as its App Process: no page and no document. It
   * offers its Peek Tools and, with `agentConnection`, pairs with the
   * agent's Ayme MCP server beside the page.
   */
  function startInProcess(): () => void {
    if (appProcessHolder.__aymeAppProcess)
      throw new RuntimeStateError(
        "The Ayme runtime already has an active owner.",
        { code: "active-owner" }
      );
    const processController = new AbortController();
    // Without the Agent Connection, Node offers no Peeks (ADR-0034).
    const unsubscribe = peeks
      ? target.peeks()!.subscribeToPeekTools(refreshTools)
      : () => {};
    const session = {
      stop() {
        if (inProcess !== session) return;
        inProcess = undefined;
        if (appProcessHolder.__aymeAppProcess === session)
          appProcessHolder.__aymeAppProcess = undefined;
        processController.abort();
        unsubscribe();
        refreshTools();
      },
    };
    inProcess = session;
    appProcessHolder.__aymeAppProcess = session;
    refreshTools();
    const { agentConnection } = options;
    if (agentConnection) {
      const where = agentConnection === true ? {} : agentConnection;
      startAgentConnectionUntil(processController.signal, () =>
        surfaces!.loadProcessConnection().then(
          ({ startAgentConnection }) =>
            () =>
              // Its tools listed as Ayme MCP lists the page's; its calls run
              // through the session as before.
              startAgentConnection(
                {
                  tools: {
                    ...ayme.tools,
                    list: aymeMcpTools.list,
                    subscribe: aymeMcpTools.subscribe,
                  },
                },
                where
              )
        )
      );
    }
    return () => session.stop();
  }

  appProcessToolsBySession.set(ayme, appProcessTools.tools);
  setAgentConnectionStatus(ayme, agentConnectionStatus.status);
  return ayme;
}

// A load failure while the session runs stays an unhandled rejection, so it
// reaches the console. Once the session has stopped, nothing would mount,
// so the failure is dropped, such as an import cut short by a teardown.
function mountInspectorUntil(
  loadInspector: SessionTarget["surfaces"] extends infer S
    ? S extends { loadInspector: infer L }
      ? L
      : never
    : never,
  signal: AbortSignal
) {
  void loadInspector().then(
    ({ mountInspector }) => {
      if (signal.aborted) return;
      const inspector = mountInspector();
      signal.addEventListener("abort", () => inspector.dispose(), {
        once: true,
      });
    },
    (error: unknown) => {
      if (!signal.aborted) throw error;
    }
  );
}

// Like the Inspector: a load failure while the session runs stays an
// unhandled rejection, after `onFailure`, and one after it has stopped is
// dropped. `load` loads the page client or the App Process's side, and
// resolves with what starts it.
function startAgentConnectionUntil(
  signal: AbortSignal,
  load: () => Promise<() => { dispose(): void }>,
  onFailure?: () => void
) {
  void load().then(
    (startConnection) => {
      if (signal.aborted) return;
      const connection = startConnection();
      signal.addEventListener("abort", () => connection.dispose(), {
        once: true,
      });
    },
    (error: unknown) => {
      if (signal.aborted) return;
      onFailure?.();
      throw error;
    }
  );
}
