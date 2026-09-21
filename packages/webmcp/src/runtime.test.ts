import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as goalLoopModule from "./goalLoop";
import * as pageState from "./pageState";
import { createRuntimeSession, type AymePage } from "./runtime";
import { listRegisteredPoms, registerCompiledPom } from "./registry";
import {
  synchronizeWebMcpTools,
  waitForWebMcpDriver,
  type WebMcpDriver,
  type WebMcpRegistration,
} from "./webMcp";

vi.mock("./webMcp", () => ({
  synchronizeWebMcpTools: vi.fn(),
  waitForWebMcpDriver: vi.fn(),
}));
const page = {} as AymePage;
const sessions: ReturnType<typeof createRuntimeSession>[] = [];
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
  vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", enabled);
  const runtime = createRuntimeSession(page);
  sessions.push(runtime);
  return runtime;
}
function start(runtime: ReturnType<typeof createRuntimeSession>) {
  const stop = runtime.start();
  stops.push(stop);
  return stop;
}
beforeEach(() => {
  vi.clearAllMocks();
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

it("threads ignore to page state capture for the session lifetime", () => {
  const configureIgnore = vi.spyOn(pageState, "configurePageStateIgnore");
  try {
    const ignore = (element: Element) => element.matches(".assistant");
    const runtime = createRuntimeSession(page, { ignore });
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
    const runtime = createRuntimeSession(page, { goalLoop });
    expect(configureGoalLoop).not.toHaveBeenCalled();
    const stop = start(runtime);
    expect(configureGoalLoop).toHaveBeenLastCalledWith(goalLoop);
    stop();
    expect(configureGoalLoop).toHaveBeenLastCalledWith(undefined);
  } finally {
    configureGoalLoop.mockRestore();
  }
});

it("creates the default browser page lazily", () => {
  vi.stubGlobal("window", undefined);
  const runtime = createRuntimeSession();
  expect(runtime.getSnapshot()).toEqual({
    state: "disabled",
    message: "WebMCP publication is disabled.",
  });
});

it("constructs without activation and handles registration before owner startup and replay", () => {
  const runtime = session(false);
  const instance = runtime.construct(Model);
  expect(instance.page).toBe(page);
  expect(listRegisteredPoms()).toHaveLength(0);
  const unregister = runtime.register(Model, instance);
  expect(listRegisteredPoms()).toHaveLength(0);
  const stop = start(runtime);
  expect(listRegisteredPoms()[0]?.instance).toBe(instance);
  stop();
  expect(listRegisteredPoms()).toHaveLength(0);
  start(runtime);
  expect(listRegisteredPoms()[0]?.instance).toBe(instance);
  unregister();
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(waitForWebMcpDriver).not.toHaveBeenCalled();
});

it("rejects concurrent owners and permits a fresh owner after disposal", () => {
  const first = session(false);
  const second = session(false);
  const stop = start(first);
  expect(() => second.start()).toThrow("active owner");
  stop();
  start(second);
});

it("publishes once, shares retries, and exposes immutable status snapshots", async () => {
  const runtime = session();
  const listener = vi.fn();
  const unsubscribe = runtime.subscribe(listener);
  start(runtime);
  const pending = runtime.retryPublication();
  expect(runtime.retryPublication()).toBe(pending);
  await pending;
  expect(runtime.getSnapshot().state).toBe("active");
  expect(Object.isFrozen(runtime.getSnapshot())).toBe(true);
  await runtime.retryPublication();
  expect(synchronizeWebMcpTools).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});

it("retries unavailable and failed publication", async () => {
  vi.mocked(waitForWebMcpDriver).mockResolvedValueOnce(undefined);
  vi.mocked(synchronizeWebMcpTools).mockRejectedValueOnce(
    new Error("registration failed")
  );
  const runtime = session();
  start(runtime);
  await runtime.retryPublication();
  expect(runtime.getSnapshot().state).toBe("unavailable");
  await runtime.retryPublication();
  expect(runtime.getSnapshot()).toEqual({
    state: "failed",
    message: "WebMCP publication failed: registration failed",
  });
  await runtime.retryPublication();
  expect(runtime.getSnapshot().state).toBe("active");
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
  await runtime.retryPublication();
  expect(runtime.getSnapshot().state).toBe("failed");
  expect(disposePublication).toHaveBeenCalledOnce();
  await runtime.retryPublication();
  expect(runtime.getSnapshot().state).toBe("active");
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
  const pending = runtime.retryPublication();
  stop();
  expect(vi.mocked(waitForWebMcpDriver).mock.calls[0]?.[1]?.aborted).toBe(true);
  resolve(driver);
  await pending;
  expect(synchronizeWebMcpTools).not.toHaveBeenCalled();
  expect(runtime.getSnapshot().state).toBe("disposed");
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
  await runtime.retryPublication();
  const disposeLate = vi.fn();
  resolve({ message: "Late", dispose: disposeLate });
  await flush();
  expect(disposeLate).toHaveBeenCalledOnce();
  expect(runtime.getSnapshot()).toEqual({
    state: "active",
    message: "Published",
  });
});
