import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordAgentImageRun } from "./agentImageRuns";
import { createPage } from "./browserPage";
import { loadAgentConnection } from "./agentConnection";
import { cursors } from "./cursors";
import { RuntimeStateError } from "./errors";
import * as goalLoopModule from "./goalLoop";
import { loadInspector } from "./inspector";
import * as navigateToolModule from "./navigateTool";
import * as pageState from "./pageState";
import {
  createAyme,
  type Ayme,
  markRenderSession,
  sameRuntimeOptions,
  type AymePage,
} from "./runtime";
import { listWebMcpTools } from "./publishedTools";
import { listRegisteredPoms, registerCompiledPom } from "./registry";
import * as registryModule from "./registry";
import { callers } from "./run";
import { loadWebMcpPublication } from "./webMcp";

vi.mock("./webMcp", () => ({ loadWebMcpPublication: vi.fn() }));
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
type StartWebMcpPublication = Awaited<
  ReturnType<typeof loadWebMcpPublication>
>["startWebMcpPublication"];
const retry = vi.fn<() => Promise<void>>();
const startWebMcpPublication = vi.fn<StartWebMcpPublication>(() => ({
  retry,
}));
/** The tool source and options the session last started publication with. */
function published() {
  const [tools, options] = startWebMcpPublication.mock.lastCall!;
  return { tools, options };
}
/**
 * Waits until the session has started publication `times` times in all: it
 * starts once the package has loaded and the Page Objects have been probed.
 */
const publicationStarts = (times = 1) =>
  vi.waitFor(() => expect(startWebMcpPublication).toHaveBeenCalledTimes(times));
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
  retry.mockResolvedValue(undefined);
  vi.mocked(loadWebMcpPublication).mockResolvedValue({
    startWebMcpPublication,
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
  ["WebMCP publication", { webMCP: { enabled: true } }],
] as const)(
  "drops a %s load failure once the session has stopped",
  async (_, option) => {
    let failLoad!: (error: Error) => void;
    const failing = new Promise<never>((_, reject) => (failLoad = reject));
    vi.mocked(loadInspector).mockReturnValue(failing);
    vi.mocked(loadAgentConnection).mockReturnValue(failing);
    vi.mocked(loadWebMcpPublication).mockReturnValue(failing);
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
  expect(startAgentConnection).toHaveBeenCalledOnce();
  // The page client reaches the session's tools, and runs them as ayme-mcp.
  const [{ tools, recordAgentImage }] = startAgentConnection.mock
    .calls[0] as unknown as [
    { tools: Ayme["tools"]; recordAgentImage: unknown },
  ];
  expect(recordAgentImage).toBe(recordAgentImageRun);
  expect(tools.list()).toBe(runtime.tools.list());
  const run = vi.spyOn(runtime.tools, "run").mockResolvedValue("ran");
  await expect(tools.run("snapshot", {})).resolves.toBe("ran");
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "snapshot",
    {},
    {
      by: "ayme-mcp",
    }
  );
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
  expect(loadWebMcpPublication).not.toHaveBeenCalled();
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
  const execute = vi.fn(async () => handover);
  const goalTool = vi
    .spyOn(goalLoopModule, "getPursueGoalTool")
    .mockReturnValue({
      name: "goal",
      description: "Drive the page toward a goal.",
      inputSchema: { type: "object" },
      execute,
    });
  try {
    const runtime = session();
    start(runtime);
    await publicationStarts();
    published().options.onStatus({
      state: "unavailable",
      message: "The WebMCP driver is unavailable.",
    });
    expect(runtime.webMCP.publicationStatus.state).toBe("unavailable");
    const input = { goal: "save", maxSteps: 3 };
    await expect(runtime.tools.run("goal", input)).resolves.toBe(handover);
    expect(execute).toHaveBeenCalledExactlyOnceWith(input, {
      cursor: cursors.of(callers.app),
      run: expect.any(Function),
    });
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
  expect(loadWebMcpPublication).not.toHaveBeenCalled();
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

it("publishes while a session with webMCP.enabled is started, under its toolNamePrefix", async () => {
  start(session(false))();
  await flush();
  expect(loadWebMcpPublication).not.toHaveBeenCalled();

  const runtime = createAyme({
    pageFactory: () => page,
    webMCP: { enabled: true, toolNamePrefix: "ayme_" },
  });
  sessions.push(runtime);
  const stop = start(runtime);
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "waiting",
    message: "Waiting for the WebMCP driver.",
  });
  await publicationStarts();
  const { options } = published();
  expect(options).toEqual({
    toolNamePrefix: "ayme_",
    signal: expect.any(AbortSignal),
    onStatus: expect.any(Function),
  });
  expect(options.signal.aborted).toBe(false);

  stop();
  expect(options.signal.aborted).toBe(true);
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "disposed",
    message: "The Ayme runtime was disposed.",
  });
});

it("probes the Page Objects before it publishes", async () => {
  let finishProbe!: () => void;
  const probe = vi
    .spyOn(registryModule, "probeRegisteredPomMembers")
    .mockReturnValueOnce(new Promise((resolve) => (finishProbe = resolve)));
  try {
    start(session());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probe).toHaveBeenCalledOnce();
    expect(loadWebMcpPublication).toHaveBeenCalledOnce();
    expect(startWebMcpPublication).not.toHaveBeenCalled();

    finishProbe();

    await publicationStarts();
  } finally {
    probe.mockRestore();
  }
});

it("loads nothing while webMCP.enabled is unset", async () => {
  const runtime = createAyme({
    pageFactory: () => page,
    webMCP: { toolNamePrefix: "ayme_" },
  });
  sessions.push(runtime);
  start(runtime);
  await runtime.webMCP.retryPublication();
  await flush();

  expect(loadWebMcpPublication).not.toHaveBeenCalled();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "disabled",
    message: "WebMCP publication is disabled.",
  });
});

it("publishes the tools WebMCP can carry, and runs an agent's call as a webmcp Run", async () => {
  class Saver {
    save() {}
  }
  registerCompiledPom(Saver, {
    className: "Saver",
    components: [],
    members: [],
    tools: [
      {
        methodName: "save",
        toolName: "Saver.save",
        description: "Save.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        parameters: [],
      },
    ],
  });
  const runtime = session();
  start(runtime);
  await publicationStarts();
  const { tools } = published();
  const names = () => tools.list().map(({ name }) => name);
  expect(tools.list()).toEqual(listWebMcpTools());
  expect(names()).toContain("click");
  // Its result is an image, which WebMCP cannot carry.
  expect(names()).not.toContain("screenshot");
  expect(runtime.tools.list().map(({ name }) => name)).toContain("screenshot");

  const listener = vi.fn();
  const unsubscribe = tools.subscribe(listener);
  runtime.pom.register(Saver);
  expect(listener).toHaveBeenCalledExactlyOnceWith();
  expect(names()).toContain("Saver.save");
  unsubscribe();
  runtime.pom.unregister(Saver);
  expect(listener).toHaveBeenCalledOnce();

  const run = vi.spyOn(runtime.tools, "run").mockResolvedValue("ran");
  await expect(tools.run("snapshot", {})).resolves.toBe("ran");
  expect(run).toHaveBeenCalledExactlyOnceWith("snapshot", {}, { by: "webmcp" });
});

it("shows each status publication reports, frozen, and tells subscribers", async () => {
  const runtime = session();
  const listener = vi.fn();
  const unsubscribe = runtime.webMCP.subscribe(listener);
  start(runtime);
  await publicationStarts();
  expect(listener).toHaveBeenLastCalledWith({
    state: "waiting",
    message: "Waiting for the WebMCP driver.",
  });

  published().options.onStatus({
    state: "active",
    message: "Registered 17 WebMCP tools and watching for changes.",
  });

  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "active",
    message: "Registered 17 WebMCP tools and watching for changes.",
  });
  expect(Object.isFrozen(runtime.webMCP.publicationStatus)).toBe(true);
  expect(listener).toHaveBeenLastCalledWith(runtime.webMCP.publicationStatus);
  unsubscribe();
});

it("retries through the publication, resolving once its attempt ends", async () => {
  let finishAttempt!: () => void;
  retry.mockReturnValueOnce(
    new Promise<void>((resolve) => (finishAttempt = resolve))
  );
  const runtime = session();
  start(runtime);
  let retried = false;

  const retrying = runtime.webMCP.retryPublication().then(() => {
    retried = true;
  });
  await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
  expect(retried).toBe(false);
  finishAttempt();
  await retrying;

  expect(loadWebMcpPublication).toHaveBeenCalledOnce();
  expect(startWebMcpPublication).toHaveBeenCalledOnce();
});

it("shows a load failure as failed publication, and loads again on a retry", async () => {
  vi.mocked(loadWebMcpPublication).mockRejectedValueOnce(
    new Error(
      "The webMCP option could not load @ayme-dev/webmcp. Install it beside @ayme-dev/ayme, or turn the option off. Cause: Cannot find package."
    )
  );
  const runtime = session();
  start(runtime);
  await flush();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "failed",
    message:
      "WebMCP publication failed: The webMCP option could not load @ayme-dev/webmcp. Install it beside @ayme-dev/ayme, or turn the option off. Cause: Cannot find package.",
  });
  expect(startWebMcpPublication).not.toHaveBeenCalled();

  const retrying = runtime.webMCP.retryPublication();
  expect(runtime.webMCP.publicationStatus.state).toBe("waiting");
  await retrying;

  expect(loadWebMcpPublication).toHaveBeenCalledTimes(2);
  expect(startWebMcpPublication).toHaveBeenCalledOnce();
  expect(published().options.signal.aborted).toBe(false);
  expect(retry).toHaveBeenCalledOnce();
});

it("shows a publication that throws as it starts as failed, and starts it again on a retry", async () => {
  startWebMcpPublication.mockImplementationOnce(() => {
    throw new Error("A status listener threw.");
  });
  const runtime = session();
  start(runtime);
  await publicationStarts();
  await flush();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "failed",
    message: "WebMCP publication failed: A status listener threw.",
  });

  await runtime.webMCP.retryPublication();

  expect(startWebMcpPublication).toHaveBeenCalledTimes(2);
  expect(retry).toHaveBeenCalledOnce();
});

it("ignores a load that ends after its session stopped, leaving a later start's publication alone", async () => {
  let finishLoad!: (loaded: {
    startWebMcpPublication: StartWebMcpPublication;
  }) => void;
  let failLoad!: (error: Error) => void;
  vi.mocked(loadWebMcpPublication)
    .mockReturnValueOnce(new Promise((resolve) => (finishLoad = resolve)))
    .mockReturnValueOnce(new Promise((_, reject) => (failLoad = reject)));
  const runtime = session();
  // Two starts stop before their loads end; the third publishes.
  start(runtime)();
  start(runtime)();
  start(runtime);
  await publicationStarts();
  published().options.onStatus({ state: "active", message: "Published." });

  finishLoad({ startWebMcpPublication });
  failLoad(new Error("Cannot load the package after teardown."));
  // What the late loads set off runs in promise callbacks, before a timer.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(startWebMcpPublication).toHaveBeenCalledOnce();
  expect(runtime.webMCP.publicationStatus).toEqual({
    state: "active",
    message: "Published.",
  });
});
