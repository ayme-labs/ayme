import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordAgentImageRun } from "./agentImageRuns";
import { createPage } from "./browserPage";
import { loadAgentConnection } from "./agentConnection";
import { RuntimeStateError } from "./errors";
import * as goalLoopModule from "./goalLoop";
import { loadInspector } from "./inspector";
import * as navigateToolModule from "./navigateTool";
import * as pageState from "./pageState";
import {
  createAyme,
  markRenderSession,
  sameRuntimeOptions,
  type AymePage,
} from "./runtime";
import { listRegisteredPoms, registerCompiledPom } from "./registry";
import {
  synchronizeWebMcpTools,
  waitForWebMcpDriver,
  type WebMcpDriver,
  type WebMcpRegistration,
} from "./webMcp";

vi.mock("./webMcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./webMcp")>()),
  synchronizeWebMcpTools: vi.fn(),
  waitForWebMcpDriver: vi.fn(),
}));
vi.mock("./inspector", () => ({ loadInspector: vi.fn() }));
vi.mock("./agentConnection", () => ({
  loadAgentConnection: vi.fn(),
  loadProcessConnection: vi.fn(),
}));
vi.mock("./browserPage", () => ({
  createPage: vi.fn(() => ({}) as AymePage),
}));
const page = { url: () => "factory page" } as unknown as AymePage;
const sessions: ReturnType<typeof createAyme>[] = [];
const stops: (() => void)[] = [];
const driver = { registerTool: vi.fn() };
const disposePublication = vi.fn();
class Model {
  constructor(readonly page: AymePage) {}
}
const manifest = { className: "Model", components: [], members: [], tools: [] };
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function session(enabled = true) {
  const runtime = createAyme({
    pageFactory: () => page,
    webMCP: { enabled },
  });
  sessions.push(runtime);
  return runtime;
}
function start(runtime: ReturnType<typeof createAyme>) {
  const stop = runtime.start();
  stops.push(stop);
  return stop;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  registerCompiledPom(Model, manifest);
  vi.mocked(waitForWebMcpDriver).mockResolvedValue(driver);
  vi.mocked(synchronizeWebMcpTools).mockResolvedValue({
    message: "Published",
    dispose: disposePublication,
  });
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  sessions.length = 0;
  pageState.configurePageStateIgnore(undefined);
  goalLoopModule.configureGoalLoop(undefined);
  vi.unstubAllGlobals();
});

it("mounts the Inspector while a session with inspector is started", async () => {
  const dispose = vi.fn();
  const mountInspector = vi.fn(() => ({ dispose }));
  vi.mocked(loadInspector).mockResolvedValue({ mountInspector });
  start(session(false))();
  expect(loadInspector).not.toHaveBeenCalled();

  const runtime = createAyme({
    pageFactory: () => page,
    inspector: true,
  });
  sessions.push(runtime);
  const stop = start(runtime);
  await flush();
  expect(mountInspector).toHaveBeenCalledExactlyOnceWith({ demo: false });
  stop();
  expect(dispose).toHaveBeenCalledOnce();

  // Stopped before the Inspector loaded: nothing is mounted.
  start(runtime)();
  await flush();
  expect(mountInspector).toHaveBeenCalledOnce();
});

it.each([
  ["Inspector", { inspector: true }],
  ["Agent Connection", { agentConnection: true }],
] as const)(
  "drops a %s load failure once the session has stopped",
  async (_, option) => {
    let failLoad!: (error: Error) => void;
    const failing = new Promise<never>((_, reject) => (failLoad = reject));
    vi.mocked(loadInspector).mockReturnValue(failing);
    vi.mocked(loadAgentConnection).mockReturnValue(failing);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const runtime = createAyme({ pageFactory: () => page, ...option });
      sessions.push(runtime);
      start(runtime)();
      // As when a test's environment is torn down before the import ends.
      failLoad(new Error("Cannot load the package after teardown."));
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  }
);

it("mounts the Inspector in demo mode when inspector asks for it", async () => {
  const mountInspector = vi.fn(() => ({ dispose: vi.fn() }));
  vi.mocked(loadInspector).mockResolvedValue({ mountInspector });

  for (const demo of [true, false]) {
    const runtime = createAyme({
      pageFactory: () => page,
      inspector: { demo },
    });
    sessions.push(runtime);
    const stop = start(runtime);
    await flush();
    stop();
  }

  expect(mountInspector.mock.calls).toEqual([
    [{ demo: true }],
    [{ demo: false }],
  ]);
});

it("compares the inspector option by what it turns on", () => {
  expect(
    sameRuntimeOptions(
      { inspector: { demo: true } },
      { inspector: { demo: true } }
    )
  ).toBe(true);
  expect(
    sameRuntimeOptions({ inspector: true }, { inspector: { demo: false } })
  ).toBe(true);
  expect(sameRuntimeOptions({ inspector: false }, {})).toBe(true);
  expect(
    sameRuntimeOptions({ inspector: true }, { inspector: { demo: true } })
  ).toBe(false);
  expect(sameRuntimeOptions({ inspector: true }, { inspector: false })).toBe(
    false
  );
});

it("starts the Agent Connection while a session with agentConnection is started", async () => {
  const dispose = vi.fn();
  const startAgentConnection = vi.fn(() => ({
    dispose,
    processTools: { list: () => [], subscribe: () => () => {}, run: vi.fn() },
  }));
  vi.mocked(loadAgentConnection).mockResolvedValue({ startAgentConnection });
  start(session(false))();
  expect(loadAgentConnection).not.toHaveBeenCalled();

  const runtime = createAyme({
    pageFactory: () => page,
    agentConnection: true,
  });
  sessions.push(runtime);
  const stop = start(runtime);
  await flush();
  expect(startAgentConnection).toHaveBeenCalledExactlyOnceWith({
    tools: runtime.tools,
    recordAgentImage: recordAgentImageRun,
  });
  stop();
  expect(dispose).toHaveBeenCalledOnce();

  // Stopped before the page client loaded: no connection starts.
  start(runtime)();
  await flush();
  expect(startAgentConnection).toHaveBeenCalledOnce();
});

it("threads ignore to page state capture for the session lifetime", () => {
  const configureIgnore = vi.spyOn(pageState, "configurePageStateIgnore");
  try {
    const ignore = (element: Element) => element.matches(".assistant");
    const runtime = createAyme({ pageFactory: () => page, ignore });
    expect(configureIgnore).not.toHaveBeenCalled();
    const stop = start(runtime);
    expect(configureIgnore).toHaveBeenLastCalledWith(ignore);
    stop();
    expect(configureIgnore).toHaveBeenLastCalledWith(undefined);
  } finally {
    configureIgnore.mockRestore();
  }
});

it("threads goalLoop to the goal loop configuration for the session lifetime", () => {
  const configureGoalLoop = vi.spyOn(goalLoopModule, "configureGoalLoop");
  try {
    const goalLoop = vi.fn();
    const runtime = createAyme({ pageFactory: () => page, goalLoop });
    expect(configureGoalLoop).not.toHaveBeenCalled();
    const stop = start(runtime);
    expect(configureGoalLoop).toHaveBeenLastCalledWith(goalLoop);
    stop();
    expect(configureGoalLoop).toHaveBeenLastCalledWith(undefined);
  } finally {
    configureGoalLoop.mockRestore();
  }
});

it("threads navigate to the navigate tool for the session lifetime", () => {
  const configureRouterNavigate = vi.spyOn(
    navigateToolModule,
    "configureRouterNavigate"
  );
  try {
    const navigate = vi.fn();
    const runtime = createAyme({ pageFactory: () => page, navigate });
    expect(configureRouterNavigate).not.toHaveBeenCalled();
    const stop = start(runtime);
    expect(configureRouterNavigate).toHaveBeenLastCalledWith(navigate);
    stop();
    expect(configureRouterNavigate).toHaveBeenLastCalledWith(undefined);
  } finally {
    configureRouterNavigate.mockRestore();
  }
});

it("counts a different navigate function as a different setup", () => {
  const navigate = () => {};
  expect(sameRuntimeOptions({ navigate }, { navigate })).toBe(true);
  expect(sameRuntimeOptions({ navigate }, { navigate: () => {} })).toBe(false);
  expect(sameRuntimeOptions({ navigate }, {})).toBe(false);
});

it("creates the default browser page lazily", () => {
  vi.stubGlobal("window", undefined);
  const runtime = createAyme();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "disabled",
    message: "WebMCP publication is disabled.",
  });
  expect(createPage).not.toHaveBeenCalled();
});

it("builds the default page with createPage() and no options, once", () => {
  const runtime = session(false);
  const defaultRuntime = createAyme();
  sessions.push(defaultRuntime);
  expect(createPage).not.toHaveBeenCalled();
  start(defaultRuntime);
  expect(createPage).toHaveBeenCalledOnce();
  expect(createPage).toHaveBeenCalledWith();
  expect(runtime.pom.get(Model).page.url()).toBe(page.url());
  expect(createPage).toHaveBeenCalledOnce();
});

it("never calls the page factory on the server", () => {
  vi.stubGlobal("window", undefined);
  const factory = vi.fn(() => page);
  const runtime = createAyme({ pageFactory: factory });
  sessions.push(runtime);
  const instance = runtime.pom.get(Model);
  expect(instance).toBeInstanceOf(Model);
  expect(instance.page).toBeUndefined();
  // One instance per class on the server too, as in the browser.
  expect(runtime.pom.get(Model)).toBe(instance);
  expect(runtime.pom.register(Model)).toBe(instance);
  expect(runtime.tools.list()).toEqual([]);
  expect(factory).not.toHaveBeenCalled();
  expect(createPage).not.toHaveBeenCalled();
});

it("C9: starts and registers nothing for concurrent render sessions on the server", () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  const factory = vi.fn(() => page);
  const first = createAyme({ pageFactory: factory, webMCP: { enabled: true } });
  const second = createAyme({ pageFactory: factory });
  sessions.push(first, second);
  markRenderSession(first);
  markRenderSession(second);
  const instance = first.pom.register(Model);
  const stopFirst = start(first);
  // A second render session is no owner conflict.
  const stopSecond = start(second);
  expect(first.webMCP.publicationStatus.state).toBe("waiting");
  expect(second.webMCP.publicationStatus.state).toBe("disabled");
  expect(first.tools.list()).toEqual([]);
  expect(listRegisteredPoms()).toHaveLength(0);
  first.pom.unregister(Model);
  stopFirst();
  stopSecond();
  expect(first.webMCP.publicationStatus.state).toBe("waiting");
  expect(instance).toBeInstanceOf(Model);
  expect(factory).not.toHaveBeenCalled();
  expect(createPage).not.toHaveBeenCalled();
  expect(synchronizeWebMcpTools).not.toHaveBeenCalled();
});

it("calls the page factory at most once, lazily, on first use", () => {
  const factory = vi.fn(() => page);
  const runtime = createAyme({ pageFactory: factory });
  sessions.push(runtime);
  expect(factory).not.toHaveBeenCalled();
  expect(runtime.pom.get(Model).page.url()).toBe(page.url());
  expect(factory).toHaveBeenCalledOnce();
  const stop = start(runtime);
  stop();
  start(runtime);
  expect(factory).toHaveBeenCalledOnce();
  expect(createPage).not.toHaveBeenCalled();
});

it("rejects a run before start, after stop and for a tool that does not exist", async () => {
  const runtime = session(false);
  await expect(
    runtime.tools.run("goal", { goal: "save", maxSteps: 1 })
  ).rejects.toThrow(
    'Cannot run the tool "goal": the Ayme runtime session is not started.'
  );
  const stop = start(runtime);
  await expect(
    runtime.tools.run("goal", { goal: "save", maxSteps: 1 })
  ).rejects.toThrow('There is no tool "goal".');
  stop();
  await expect(runtime.tools.run("Unknown.tool", {})).rejects.toBeInstanceOf(
    RuntimeStateError
  );
});

it("exposes publication status and retry only under its webMCP member", () => {
  const runtime = session(false);
  expect(runtime.webMCP.publicationStatus.state).toBe("disabled");
  expect(typeof runtime.webMCP.retryPublication).toBe("function");
  for (const member of [
    "publicationStatus",
    "retryPublication",
    "getSnapshot",
    "subscribe",
    "construct",
    "register",
    "page",
    "goalLoop",
    "pursueGoal",
  ])
    expect(runtime).not.toHaveProperty(member);
});

it("lists the live tools while started, keeping the array until the set changes", () => {
  const runtime = createAyme({ pageFactory: () => page, goalLoop: vi.fn() });
  sessions.push(runtime);
  const listener = vi.fn();
  runtime.tools.subscribe(listener);
  expect(runtime.tools.list()).toEqual([]);
  const stop = start(runtime);
  const tools = runtime.tools.list();
  expect(tools.map(({ name }) => name)).toContain("goal");
  expect(tools.find(({ name }) => name === "click")?.group).toBe("browser");
  expect(listener).toHaveBeenCalledExactlyOnceWith(tools);
  runtime.pom.register(Model);
  expect(runtime.tools.list()).toBe(tools);
  expect(listener).toHaveBeenCalledOnce();
  stop();
  expect(runtime.tools.list()).toEqual([]);
  expect(listener).toHaveBeenLastCalledWith([]);
  expect(listener).toHaveBeenCalledTimes(2);
});

it("runs goal as the application while publication is unavailable", async () => {
  const handover = { reason: "done" as const, next: "Continue.", history: [] };
  const executeAs = vi.fn(async () => handover);
  const goalTool = vi
    .spyOn(goalLoopModule, "getPursueGoalTool")
    .mockReturnValue({
      name: "goal",
      description: "Drive the page toward a goal.",
      inputSchema: { type: "object" },
      execute: vi.fn(),
      executeAs,
    });
  try {
    vi.mocked(waitForWebMcpDriver).mockResolvedValue(undefined);
    const runtime = session();
    start(runtime);
    await runtime.webMCP.retryPublication();
    expect(runtime.webMCP.publicationStatus.state).toBe("unavailable");
    const input = { goal: "save", maxSteps: 3 };
    await expect(runtime.tools.run("goal", input)).resolves.toBe(handover);
    expect(executeAs).toHaveBeenCalledExactlyOnceWith(input, "app");
    expect(synchronizeWebMcpTools).not.toHaveBeenCalled();
  } finally {
    goalTool.mockRestore();
  }
});

it("gets without activation and handles registration before owner startup and replay", () => {
  const runtime = session(false);
  const instance = runtime.pom.get(Model);
  expect(instance.page.url()).toBe(page.url());
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(runtime.pom.register(Model)).toBe(instance);
  expect(listRegisteredPoms()).toHaveLength(0);
  const stop = start(runtime);
  expect(listRegisteredPoms()[0]?.instance).toBe(instance);
  stop();
  expect(listRegisteredPoms()).toHaveLength(0);
  start(runtime);
  expect(listRegisteredPoms()[0]?.instance).toBe(instance);
  runtime.pom.unregister(Model);
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(waitForWebMcpDriver).not.toHaveBeenCalled();
});

it("shares one instance between registrations and withdraws it with the last", () => {
  const runtime = session(false);
  start(runtime);
  const first = runtime.pom.register(Model);
  expect(runtime.pom.register(Model)).toBe(first);
  expect(listRegisteredPoms()).toHaveLength(1);
  runtime.pom.unregister(Model);
  expect(listRegisteredPoms()).toHaveLength(1);
  runtime.pom.unregister(Model);
  expect(listRegisteredPoms()).toHaveLength(0);
  runtime.pom.unregister(Model);
  expect(runtime.pom.register(Model)).toBe(first);
  expect(listRegisteredPoms()).toHaveLength(1);
});

it("fails to start with two distinct classes sharing a name, and starts once one is gone", () => {
  const OtherModel = class Model {
    constructor(readonly page: AymePage) {}
  };
  registerCompiledPom(OtherModel, manifest);
  const runtime = session(false);
  runtime.pom.register(Model);
  runtime.pom.register(OtherModel);
  expect(() => runtime.start()).toThrow(
    'Cannot register the Page Object "Model"'
  );
  expect(listRegisteredPoms()).toHaveLength(0);
  runtime.pom.unregister(OtherModel);
  start(runtime);
  expect(
    listRegisteredPoms().map(({ instance }) => instance.constructor)
  ).toEqual([Model]);
});

it("C3: rejects concurrent owners with the active-owner code and permits a fresh owner after disposal", () => {
  const first = session(false);
  const second = session(false);
  const stop = start(first);
  expect(() => second.start()).toThrow(
    expect.objectContaining({
      name: "RuntimeStateError",
      message: "The Ayme runtime already has an active owner.",
      code: "active-owner",
    })
  );
  stop();
  start(second);
});

it("publishes once, shares retries, and exposes immutable status snapshots", async () => {
  const runtime = session();
  const listener = vi.fn();
  const unsubscribe = runtime.webMCP.subscribe(listener);
  start(runtime);
  const pending = runtime.webMCP.retryPublication();
  expect(runtime.webMCP.retryPublication()).toBe(pending);
  await pending;
  expect(runtime.webMCP.publicationStatus.state).toBe("active");
  expect(Object.isFrozen(runtime.webMCP.publicationStatus)).toBe(true);
  await runtime.webMCP.retryPublication();
  expect(synchronizeWebMcpTools).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenLastCalledWith(runtime.webMCP.publicationStatus);
  unsubscribe();
});

it("retries unavailable and failed publication", async () => {
  vi.mocked(waitForWebMcpDriver).mockResolvedValueOnce(undefined);
  vi.mocked(synchronizeWebMcpTools).mockRejectedValueOnce(
    new Error("registration failed")
  );
  const runtime = session();
  start(runtime);
  await runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus.state).toBe("unavailable");
  await runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "failed",
    message: "WebMCP publication failed: registration failed",
  });
  await runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus.state).toBe("active");
});

it("does not overwrite a synchronous publisher failure with active status", async () => {
  vi.mocked(synchronizeWebMcpTools).mockImplementationOnce(
    async (_driver, options) => {
      options?.onError?.(new Error("startup failed"));
      return { message: "No tools", dispose: disposePublication };
    }
  );
  const runtime = session();
  start(runtime);
  await runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus.state).toBe("failed");
  expect(disposePublication).toHaveBeenCalledOnce();
  await runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus.state).toBe("active");
});

it("aborts pending discovery without publishing its late result", async () => {
  let resolve!: (driver: WebMcpDriver) => void;
  vi.mocked(waitForWebMcpDriver).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const runtime = session();
  const stop = start(runtime);
  const pending = runtime.webMCP.retryPublication();
  stop();
  expect(vi.mocked(waitForWebMcpDriver).mock.calls[0]?.[1]?.aborted).toBe(true);
  resolve(driver);
  await pending;
  expect(synchronizeWebMcpTools).not.toHaveBeenCalled();
  expect(runtime.webMCP.publicationStatus.state).toBe("disposed");
});

it("disposes late publication from an old start without overwriting its replacement", async () => {
  let resolve!: (registration: WebMcpRegistration) => void;
  vi.mocked(synchronizeWebMcpTools).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const runtime = session();
  const stop = start(runtime);
  await flush();
  stop();
  start(runtime);
  await runtime.webMCP.retryPublication();
  const disposeLate = vi.fn();
  resolve({ message: "Late", dispose: disposeLate });
  await flush();
  expect(disposeLate).toHaveBeenCalledOnce();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "active",
    message: "Published",
  });
});
