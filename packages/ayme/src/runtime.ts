import { createPage } from "./browserPage";
import { configureGoalLoop, type GoalLoopDecisionFunction } from "./goalLoop";
import { configurePageStateIgnore, getInteractionHistory } from "./pageState";
import {
  listLiveTools,
  resolvePublishedTools,
  type PublishedToolInfo,
} from "./publishedTools";
import { configureCustomTools, type CustomTool } from "./elementTools";
import { loadAgentConnection } from "./agentConnection";
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
  settledAfter,
  synchronizeWebMcpTools,
  waitForWebMcpDriver,
  type WebMcpRegistration,
} from "./webMcp";
import { RuntimeStateError } from "./errors";
import type { ToolInput, ToolResult } from "./toolTypes";

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
   * Runs a live tool as the application, through the same path as an
   * agent's call. Throws Ayme's errors, and `RuntimeStateError` while the
   * session is not started or when the tool is not live.
   */
  run<N extends string>(name: N, input: ToolInput<N>): Promise<ToolResult<N>>;
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
  readonly pom: AymePom;
  /** Starts the session; returns the function that stops it. */
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
   * Connects the page to a coding agent's Ayme MCP server through the page
   * client of the optional `@ayme-dev/mcp` package, while the session is
   * started in the browser. Off unless `true`.
   */
  agentConnection?: boolean;
  /**
   * The application's router navigation. The `navigate` tool calls it with
   * the resolved URL of a page on the document's own origin instead of
   * loading a new document, so the router keeps its in-memory state.
   */
  navigate?: (url: string) => unknown;
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
    return a[key as keyof AymeOptions] === b[key as keyof AymeOptions];
  });
}

function createServerPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const prototype = (model as unknown as { prototype: object }).prototype;
  return Object.create(prototype) as T;
}

let started: Ayme | undefined;
const startedListeners = new Set<(ayme: Ayme | undefined) => void>();

function setStarted(ayme: Ayme | undefined) {
  started = ayme;
  for (const listener of startedListeners) listener(ayme);
}

/** The session started in this document, if any, for the Inspector. */
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
  let owner: ReturnType<typeof createAymeRuntime> | undefined;
  let controller: AbortController | undefined;
  let publication: WebMcpRegistration | undefined;
  let pending: Promise<void> | undefined;

  const setStatus = (next: AymeWebMcpPublicationStatus) => {
    status = Object.freeze(next);
    for (const listener of subscribers) listener(status);
  };
  const refreshTools = () => {
    const next = owner ? listLiveTools() : NO_TOOLS;
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

  async function run(name: string, input: unknown): Promise<unknown> {
    if (!owner)
      throw new RuntimeStateError(
        `Cannot run the tool "${name}": the Ayme runtime session is not started.`
      );
    const entry = resolvePublishedTools().get(name);
    if (!entry) throw new RuntimeStateError(`The tool "${name}" is not live.`);
    const { tool } = entry;
    // As after an agent's call, the Page Objects are probed, so the live
    // tools are current when the call resolves.
    return settledAfter(
      tool,
      () => tool.executeAs(input, "app"),
      () => probeRegisteredPomMembers().catch(() => {})
    );
  }

  const pom: AymePom = {
    get<T extends object>(model: PageObjectConstructor<T>): T {
      let instance = instances.get(model) as T | undefined;
      if (!instance) {
        // Server rendering gets an inert Page Object and never runs the
        // factory; it is still the session's one instance of the class.
        instance =
          typeof window === "undefined"
            ? createServerPageObject(model)
            : constructPageObject(model, getPage());
        instances.set(model, instance);
      }
      return instance;
    },
    register<T extends object>(model: PageObjectConstructor<T>): T {
      const instance = pom.get(model);
      if (typeof window === "undefined") return instance;
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
    pom,
    start() {
      if (owner)
        throw new RuntimeStateError(
          "The Ayme runtime already has an active owner."
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
        refreshTools();
        setStatus(initialStatus);
        setStarted(ayme);
        void retryPublication();
        const inspector = inspectorMode(options);
        if (inspector !== "off")
          mountInspectorUntil(controller.signal, {
            demo: inspector === "demo",
          });
        if (options.agentConnection)
          startAgentConnectionUntil(controller.signal, ayme);
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
// unhandled rejection, and one after it has stopped is dropped.
function startAgentConnectionUntil(signal: AbortSignal, ayme: Ayme) {
  void loadAgentConnection().then(
    ({ startAgentConnection }) => {
      if (signal.aborted) return;
      const connection = startAgentConnection(ayme);
      signal.addEventListener("abort", () => connection.dispose(), {
        once: true,
      });
    },
    (error: unknown) => {
      if (!signal.aborted) throw error;
    }
  );
}
