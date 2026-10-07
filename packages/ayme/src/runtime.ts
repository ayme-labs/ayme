import { createPage } from "./browserPage";
import { configureGoalLoop, type GoalLoopDecisionFunction } from "./goalLoop";
import { configurePageStateIgnore, getInteractionHistory } from "./pageState";
import {
  listLiveTools,
  listPeekToolInfo,
  resolveLiveTools,
  resolvePublishedTools,
  type PublishedToolInfo,
} from "./publishedTools";
import { configureCustomTools, type CustomTool } from "./elementTools";
import { loadAgentConnection, loadProcessConnection } from "./agentConnection";
import { loadInspector } from "./inspector";
import { configureRouterNavigate } from "./navigateTool";
import { instrumentedPage } from "./pageInstrumentation";
import {
  constructPageObject,
  createAymeRuntime,
  probeRegisteredPomMembers,
  registerPageObject,
  subscribeToRegisteredPoms,
  type PageObjectConstructor,
} from "./registry";
import {
  synchronizeWebMcpTools,
  waitForWebMcpDriver,
  type WebMcpRegistration,
} from "./webMcp";
import { RuntimeStateError } from "./errors";
import {
  addPeek,
  listPeekTools,
  peekToolName,
  subscribeToPeekTools,
  type PeekRead,
} from "./peek";
import type { ToolInput, ToolResult } from "./toolTypes";
import {
  callerOf,
  callers,
  createRunQueue,
  runTool,
  type Caller,
  type ToolRunOptions,
} from "./run";
import { runLog, type AymeRuns } from "./runLog";

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

/** A live tool: one `tools.run` can run now. */
export type ToolInfo = PublishedToolInfo;

/** Every registered tool, by its unprefixed name, whether or not WebMCP publishes it. */
export type AymeTools = {
  /**
   * Every live tool, in publication order. The same array comes back until
   * the set changes; empty while the session is not started.
   */
  list(): readonly ToolInfo[];
  /** Calls `listener` with the new list after the live tool set changes. */
  subscribe(listener: (tools: readonly ToolInfo[]) => void): () => void;
  /**
   * Starts a Run of a live tool for the Caller `by` names, `"app"` by
   * default: every Caller, WebMCP and the Ayme MCP server included, starts
   * its Runs here. Runs take turns, one at a time per page: an action's
   * turn ends once the page has settled, a read's without a settle wait.
   * Throws Ayme's errors, and `RuntimeStateError` for an empty `by`, while
   * the session is not started, or when the tool is not live.
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
   * live while the session is started and the count is above zero.
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
   * `tools.run`, by any Caller, oldest first. A new document starts an
   * empty one.
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
   * `RuntimeStateError` when `name` is empty, or when another live tool
   * already uses the Peek Tool's name. Does nothing unless the session has
   * `agentConnection` on, or `inspector` in the browser.
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
export type { GoalLoopDecisionFunction } from "./goalLoop";

export type AymeOptions = {
  /**
   * Builds the browser Page the session drives. Called at most once, lazily,
   * on the session's first use in the browser; `createPage()` when absent.
   */
  pageFactory?: () => AymePage;
  ignore?: (element: Element) => boolean;
  customTools?: CustomTool[];
  goalLoop?: GoalLoopDecisionFunction;
  webMCP?: AymeWebMcpOptions;
  /**
   * Mounts the Inspector from the optional `@ayme-dev/inspector` package while
   * the session is started in the browser. Off unless set. `true` mounts it
   * with no demo; `{ demo: true }` also pauses before each action and shows a
   * click cue, for every call, whoever makes it.
   */
  inspector?: boolean | { demo: boolean };
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

/** What the `inspector` option turns on: nothing, the Inspector, or its demo too. */
function inspectorMode({ inspector }: AymeOptions) {
  if (!inspector) return "off";
  return inspector !== true && inspector.demo ? "demo" : "on";
}

/**
 * Whether two option objects configure the same runtime session: every option
 * is the same value, `webMCP` has the same fields, and `inspector` turns on
 * the same. The framework owners use it to keep their options fixed while
 * mounted.
 */
export function sameRuntimeOptions(a: AymeOptions, b: AymeOptions) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => {
    if (key === "webMCP")
      return (
        a.webMCP?.enabled === b.webMCP?.enabled &&
        a.webMCP?.toolNamePrefix === b.webMCP?.toolNamePrefix
      );
    if (key === "inspector") return inspectorMode(a) === inspectorMode(b);
    if (key === "agentConnection")
      return (
        JSON.stringify(a.agentConnection) === JSON.stringify(b.agentConnection)
      );
    return a[key as keyof AymeOptions] === b[key as keyof AymeOptions];
  });
}

/** The names of the tools WebMCP would publish now; none while they clash. */
function publishedToolNames(): Set<string> {
  try {
    return new Set(resolvePublishedTools().keys());
  } catch {
    return new Set();
  }
}

const onServer = () => typeof window === "undefined";

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

function createServerPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const prototype = (model as unknown as { prototype: object }).prototype;
  return Object.create(prototype) as T;
}

/** A tool an App Process paired beside the page offers. */
export type AppProcessTool = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

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
   * Runs one in its App Process, through the agent's Ayme MCP server.
   * Throws its error, or when no server is paired.
   */
  run(name: string, input: unknown): Promise<unknown>;
};

const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
const appProcessToolsBySession = new WeakMap<Ayme, AppProcessTools>();

/** The App Process tools of the session `ayme`, for the Inspector. */
export function getAppProcessTools(ayme: Ayme): AppProcessTools {
  return appProcessToolsBySession.get(ayme) ?? createAppProcessTools().tools;
}

/**
 * The session's App Process tools: those of the page client it follows,
 * and none while it follows none.
 */
function createAppProcessTools() {
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
    async run(name, input) {
      if (!followed)
        throw new RuntimeStateError(
          "No Ayme MCP server is paired with this page."
        );
      return followed.run(name, input);
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

/**
 * Create an inert runtime session. Its owner starts activity by calling
 * `start()`. `pageFactory` runs once, on first use in the browser; on the
 * server `pom.get` returns an inert Page Object. `ignore`, `customTools`,
 * `goalLoop` and `navigate` are configured on start and cleared on stop.
 */
export function createAyme(options: AymeOptions = {}): Ayme {
  let resolvedPage: AymePage | undefined;
  const getPage = () =>
    (resolvedPage ??= instrumentedPage((options.pageFactory ?? createPage)()));
  // Publication is decided once, when the session is created.
  const enabled = options.webMCP?.enabled === true;
  // Peeks reach coding agents and the Inspector only (ADR-0034). The
  // Inspector mounts only in the browser, so in Node only the Agent
  // Connection turns them on.
  const peeks =
    Boolean(options.agentConnection) ||
    (inspectorMode(options) !== "off" && !onServer());
  const toolNamePrefix = options.webMCP?.toolNamePrefix;
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
  let owner: ReturnType<typeof createAymeRuntime> | undefined;
  // The session while it runs the process's App Process, which has no
  // page: it offers its Peek Tools only.
  let inProcess: { stop(): void } | undefined;
  let controller: AbortController | undefined;
  let publication: WebMcpRegistration | undefined;
  let pending: Promise<void> | undefined;
  const appProcessTools = createAppProcessTools();
  // One top-level Run at a time on this page, whoever its Caller.
  const takeTurn = createRunQueue();

  const setStatus = (next: AymeWebMcpPublicationStatus) => {
    status = Object.freeze(next);
    for (const listener of subscribers) listener(status);
  };
  const refreshTools = () => {
    const next = owner
      ? listLiveTools({ peeks })
      : inProcess && peeks
        ? listPeekToolInfo()
        : NO_TOOLS;
    const key = JSON.stringify(next);
    if (key === toolsKey) return;
    tools = next;
    toolsKey = key;
    for (const listener of toolListeners) listener(tools);
  };
  const failed = (error: unknown) =>
    setStatus({
      state: "failed",
      message: `WebMCP publication failed: ${error instanceof Error ? error.message : String(error)}`,
    });

  function retryPublication(): Promise<void> {
    if (!enabled || !owner || publication) return Promise.resolve();
    if (pending) return pending;
    const signal = controller!.signal;
    setStatus(initialStatus);
    const attempt = (async () => {
      try {
        const driver = await waitForWebMcpDriver(2_000, signal);
        if (signal.aborted) return;
        if (!driver) {
          setStatus({
            state: "unavailable",
            message: "The WebMCP driver is unavailable.",
          });
          return;
        }
        let attemptFailed = false;
        const registration = await synchronizeWebMcpTools(driver, {
          toolNamePrefix,
          signal,
          run: (name, input, settle) =>
            runAs(name, input, callers.webmcp, settle),
          onError(error) {
            attemptFailed = true;
            if (signal.aborted) return;
            publication = undefined;
            failed(error);
          },
        });
        if (signal.aborted || attemptFailed) {
          registration.dispose();
          return;
        }
        publication = registration;
        setStatus({ state: "active", message: registration.message });
      } catch (error) {
        if (!signal.aborted) failed(error);
      }
    })();
    pending = attempt;
    void attempt.then(() => {
      if (pending === attempt) pending = undefined;
    });
    return attempt;
  }

  function stop() {
    if (!owner) return;
    controller?.abort();
    publication?.dispose();
    publication = undefined;
    pending = undefined;
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
    configurePageStateIgnore(undefined);
    configureCustomTools(undefined);
    configureGoalLoop(undefined);
    configureRouterNavigate(undefined);
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
    return runAs(name, input, callerOf(options));
  }

  /**
   * Runs the live tool `name` as a top-level Run for `by`, in its turn on
   * the page's queue. `settle` runs after an action, within the Run's turn:
   * by default the Page Objects are probed, as after an agent's call, so the
   * live tools are current. `name` is resolved when the turn starts, against
   * the tools live then.
   */
  function runAs(
    name: string,
    input: unknown,
    by: Caller,
    settle = () => probeRegisteredPomMembers().catch(() => {})
  ): Promise<unknown> {
    return takeTurn(() => runLiveTool(name, input, by, settle));
  }

  async function runLiveTool(
    name: string,
    input: unknown,
    by: Caller,
    settle: () => Promise<void>
  ): Promise<unknown> {
    if (inProcess) {
      // The Peek registry is shared by the process, so a session without
      // Peeks runs none another session added.
      const peekTool = peeks
        ? listPeekTools().find((tool) => tool.name === name)
        : undefined;
      if (!peekTool)
        throw new RuntimeStateError(`The tool "${name}" is not live.`);
      return runTool(peekTool, input, by, settle);
    }
    if (!owner)
      throw new RuntimeStateError(
        `Cannot run the tool "${name}": the Ayme runtime session is not started.`
      );
    const entry = resolveLiveTools({ peeks }).get(name);
    if (!entry) throw new RuntimeStateError(`The tool "${name}" is not live.`);
    return runLog.record(name, input, by, () =>
      runTool(entry.tool, input, by, settle)
    );
  }

  /**
   * The session's tools as the Ayme MCP server's client reaches them: its
   * Runs are `ayme-mcp`'s, so `@ayme-dev/mcp` names no Caller.
   */
  const aymeMcpTools = {
    list: () => ayme.tools.list(),
    subscribe: (listener: (tools: readonly ToolInfo[]) => void) =>
      ayme.tools.subscribe(listener),
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
      if (owner && registration.count === 0)
        registration.active = registerPageObject(model, instance);
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
    runs: { list: runLog.list, subscribe: runLog.subscribe },
    pom,
    peek(read, name, id) {
      if (typeof name !== "string" || name === "")
        throw new RuntimeStateError("A Peek needs a name.");
      if (!peeks) return () => {};
      const toolName = peekToolName(name);
      if (publishedToolNames().has(toolName))
        throw new RuntimeStateError(
          `Cannot add the Peek "${name}": another tool already uses the name ${toolName}. Rename the Peek.`
        );
      return addPeek(read, name, id);
    },
    start() {
      if (renderSessions.has(ayme)) return () => {};
      if (onServer()) return startInProcess();
      if (owner)
        throw new RuntimeStateError(
          "The Ayme runtime already has an active owner.",
          { code: "active-owner" }
        );
      owner = createAymeRuntime(getPage());
      // The document's interaction history starts with its first Visit.
      getInteractionHistory(document);
      configurePageStateIgnore(options.ignore);
      configureCustomTools(options.customTools);
      configureGoalLoop(options.goalLoop);
      configureRouterNavigate(options.navigate);
      controller = new AbortController();
      try {
        for (const [model, registration] of registrations)
          registration.active = registerPageObject(model, pom.get(model));
        unsubscribeFromPoms = subscribeToRegisteredPoms(refreshTools);
        if (peeks) unsubscribeFromPeeks = subscribeToPeekTools(refreshTools);
        refreshTools();
        setStatus(initialStatus);
        setStarted(ayme);
        void retryPublication();
        const inspector = inspectorMode(options);
        if (inspector !== "off")
          mountInspectorUntil(controller.signal, {
            demo: inspector === "demo",
          });
        if (options.agentConnection) {
          const signal = controller.signal;
          startAgentConnectionUntil(signal, () =>
            loadAgentConnection().then(({ startAgentConnection }) => () => {
              const connection = startAgentConnection({
                tools: aymeMcpTools,
              });
              // A page client from before App Processes hands over none.
              appProcessTools.follow(connection.processTools);
              signal.addEventListener(
                "abort",
                () => appProcessTools.follow(undefined),
                { once: true }
              );
              return connection;
            })
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
    const unsubscribe = peeks ? subscribeToPeekTools(refreshTools) : () => {};
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
        loadProcessConnection().then(
          ({ startAgentConnection }) =>
            () =>
              startAgentConnection(ayme, where)
        )
      );
    }
    return () => session.stop();
  }

  appProcessToolsBySession.set(ayme, appProcessTools.tools);
  return ayme;
}

// A load failure while the session runs stays an unhandled rejection, so it
// reaches the console. Once the session has stopped, nothing would mount,
// so the failure is dropped, such as an import cut short by a teardown.
function mountInspectorUntil(signal: AbortSignal, options: { demo: boolean }) {
  void loadInspector().then(
    ({ mountInspector }) => {
      if (signal.aborted) return;
      const inspector = mountInspector(options);
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
// unhandled rejection, and one after it has stopped is dropped. `load`
// loads the page client or the App Process's side, and resolves with what
// starts it.
function startAgentConnectionUntil(
  signal: AbortSignal,
  load: () => Promise<() => { dispose(): void }>
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
      if (!signal.aborted) throw error;
    }
  );
}
