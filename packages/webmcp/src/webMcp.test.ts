import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { locatorElements, testLocators, pageStateResolutions } = vi.hoisted(
  () => ({
    locatorElements: new WeakMap<object, Element[]>(),
    testLocators: new WeakSet<object>(),
    pageStateResolutions: new Map<
      string,
      { node: { ref: string; element: Element } }
    >(),
  })
);
vi.mock("@ayme-dev/playwright-lite/internal", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@ayme-dev/playwright-lite/internal")
  >()),
  isPlaywrightLiteLocator: (value: unknown) =>
    typeof value === "object" && value !== null && testLocators.has(value),
  resolveLocatorElements: (value: object) => locatorElements.get(value) ?? [],
}));
vi.mock("./pageState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pageState")>()),
  ensureCallerPageState: vi.fn().mockResolvedValue(undefined),
  resolvePageStateRefs: async (_doc: unknown, ...refs: string[]) =>
    refs.map((ref) => {
      const entry = pageStateResolutions.get(ref);
      if (entry) return { status: "resolved", requestedRef: ref, ...entry };
      return { status: "unresolved", requestedRef: ref, reason: "unknown-ref" };
    }),
}));
vi.mock("./actionSequence", () => ({
  completeAction: vi.fn(async (_doc: unknown, rawResult?: unknown) => {
    const out: Record<string, unknown> = { page_changed: false, settled: true };
    if (rawResult !== undefined) out.result = rawResult;
    return out;
  }),
}));
import type { Page } from "@playwright/test";
import { toolFailure } from "./toolFailure.testSupport";

function brandedLocator(
  overrides: Record<string, unknown> = {},
  element: Element = { isConnected: true } as Element
) {
  const loc: Record<string | symbol, unknown> = { ...overrides };
  testLocators.add(loc);
  locatorElements.set(loc, [element]);
  return loc;
}

type PublishedTool = { name: string };

vi.mock("./pageContext", () => ({
  getPageContextTool: {
    name: "get_page_context",
    description: "Get page context.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execute: async () => "",
  },
}));

class FakeMutationObserver {
  static instance: FakeMutationObserver | undefined;

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.instance = this;
  }

  trigger() {
    this.callback([], this as unknown as MutationObserver);
  }
}

const action = (methodName: string) => ({
  methodName,
  toolName: methodName,
  description: methodName,
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  parameters: [],
  returnPoms: [],
});

async function flushPublisher() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("WebMCP publisher", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeMutationObserver.instance = undefined;
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps published tools synchronized with live Page Objects", async () => {
    const registrations: Array<{
      tool: PublishedTool;
      signal: AbortSignal;
    }> = [];
    const registerTool = vi.fn(
      async (tool: PublishedTool, options: { signal: AbortSignal }) => {
        registrations.push({ tool, signal: options.signal });
      }
    );
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    let rootCount = 1;
    class ItemsPage {
      readonly addItem = vi.fn();
      readonly items = [
        {
          root: brandedLocator({ count: async () => rootCount }),
          archive: vi.fn(),
        },
      ];
    }
    registry.registerCompiledPom(ItemsPage, {
      className: "ItemsPage",
      tools: [action("addItem")],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [
        {
          className: "Item",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("archive")],
        },
      ],
    });
    const pageRegistration = registry.createPageRegistration(ItemsPage);

    const publication = await synchronizeWebMcpTools({ registerTool });
    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "addItem",
      "ItemsPage.items.archive",
    ]);

    await vi.runOnlyPendingTimersAsync();
    await flushPublisher();
    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "addItem",
      "ItemsPage.items.archive",
    ]);

    FakeMutationObserver.instance?.trigger();
    await vi.runOnlyPendingTimersAsync();
    await flushPublisher();
    expect(registerTool).toHaveBeenCalledTimes(5);

    rootCount = 0;
    FakeMutationObserver.instance?.trigger();
    await vi.runOnlyPendingTimersAsync();
    await flushPublisher();
    expect(registrations[4]?.signal.aborted).toBe(true);
    expect(registrations[0]?.signal.aborted).toBe(false);
    expect(registrations[1]?.signal.aborted).toBe(false);

    pageRegistration.dispose();
    await flushPublisher();
    expect(registrations[3]?.signal.aborted).toBe(true);
    expect(registrations[0]?.signal.aborted).toBe(false);

    const replacementPageRegistration =
      registry.createPageRegistration(ItemsPage);
    await flushPublisher();
    expect(registrations[5]?.signal.aborted).toBe(false);

    publication.dispose();
    expect(registrations[0]?.signal.aborted).toBe(true);
    expect(registrations[5]?.signal.aborted).toBe(true);

    replacementPageRegistration.dispose();
  });

  it("settles published tools before a tool call resolves", async () => {
    type ExecutableTool = PublishedTool & {
      execute(input: unknown): Promise<unknown>;
    };
    const registrations: Array<{ tool: ExecutableTool; signal: AbortSignal }> =
      [];
    const registerTool = vi.fn(
      async (tool: ExecutableTool, options: { signal: AbortSignal }) => {
        registrations.push({ tool, signal: options.signal });
      }
    );
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    let rootCount = 1;
    const itemElement = { isConnected: true } as Element;
    pageStateResolutions.set("e1", {
      node: { ref: "e1", element: itemElement },
    });
    class ItemsPage {
      readonly items = [
        {
          root: brandedLocator({ count: async () => rootCount }, itemElement),
          archive: vi.fn(() => {
            rootCount = 0;
          }),
        },
      ];
    }
    registry.registerCompiledPom(ItemsPage, {
      className: "ItemsPage",
      tools: [],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [
        {
          className: "Item",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("archive")],
        },
      ],
    });
    const pageRegistration = registry.createPageRegistration(ItemsPage);
    const publication = await synchronizeWebMcpTools({ registerTool });
    const archive = registrations.find(
      ({ tool }) => tool.name === "ItemsPage.items.archive"
    );

    const pageContext = registrations.find(
      ({ tool }) => tool.name === "get_page_context"
    );
    rootCount = 0;
    await pageContext?.tool.execute({});
    expect(archive?.signal.aborted).toBe(false);
    rootCount = 1;

    await expect(
      archive?.tool.execute({ ref: "e1", args: {} })
    ).resolves.toEqual({ page_changed: false, settled: true });
    expect(archive?.signal.aborted).toBe(true);

    publication.dispose();
    pageRegistration.dispose();
    pageStateResolutions.clear();
  });

  it("reports a failed re-publication once without failing the tool call", async () => {
    type ExecutableTool = PublishedTool & {
      execute(input: unknown): Promise<unknown>;
    };
    const tools: ExecutableTool[] = [];
    const registerTool = vi.fn(async (tool: ExecutableTool) => {
      if (tool.name === "ItemsPage.items.archive")
        throw new Error("registration failed");
      tools.push(tool);
    });
    const onError = vi.fn();
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    let rootCount = 0;
    class ItemsPage {
      readonly addItem = vi.fn(() => {
        rootCount = 1;
      });
      readonly items = [
        {
          root: brandedLocator({ count: async () => rootCount }),
          archive: vi.fn(),
        },
      ];
    }
    registry.registerCompiledPom(ItemsPage, {
      className: "ItemsPage",
      tools: [action("addItem")],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [
        {
          className: "Item",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("archive")],
        },
      ],
    });
    const pageRegistration = registry.createPageRegistration(ItemsPage);
    await synchronizeWebMcpTools({ registerTool }, { onError });
    const addItem = tools.find(({ name }) => name === "addItem");

    await expect(addItem?.execute({})).resolves.toEqual({
      page_changed: false,
      settled: true,
    });
    await flushPublisher();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(new Error("registration failed"));
    expect(
      registerTool.mock.calls.filter(
        ([tool]) => tool.name === "ItemsPage.items.archive"
      )
    ).toHaveLength(1);

    pageRegistration.dispose();
  });

  it("keeps the first live registration as the stable owner of duplicate tools", async () => {
    const registrations: Array<{
      tool: PublishedTool;
      signal: AbortSignal;
    }> = [];
    const registerTool = vi.fn(
      async (tool: PublishedTool, options: { signal: AbortSignal }) => {
        registrations.push({ tool, signal: options.signal });
      }
    );
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    class SharedPage {
      readonly run = vi.fn();
    }
    registry.registerCompiledPom(SharedPage, {
      className: "SharedPage",
      tools: [action("run")],
      members: [],
      components: [],
    });

    const first = registry.createPageRegistration(SharedPage);
    const publication = await synchronizeWebMcpTools({ registerTool });
    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "run",
    ]);

    const second = registry.createPageRegistration(SharedPage);
    await flushPublisher();
    expect(registrations).toHaveLength(4);
    expect(registrations[0]?.signal.aborted).toBe(false);
    expect(registrations[3]?.signal.aborted).toBe(false);

    second.dispose();
    await flushPublisher();
    expect(registrations).toHaveLength(4);
    expect(registrations[0]?.signal.aborted).toBe(false);
    expect(registrations[3]?.signal.aborted).toBe(false);

    const replacementOwner = registry.createPageRegistration(SharedPage);
    await flushPublisher();
    expect(registrations).toHaveLength(4);
    expect(registrations[0]?.signal.aborted).toBe(false);
    expect(registrations[3]?.signal.aborted).toBe(false);

    first.dispose();
    await flushPublisher();
    expect(registrations).toHaveLength(5);
    expect(registrations[0]?.signal.aborted).toBe(false);
    expect(registrations[3]?.signal.aborted).toBe(true);
    expect(registrations[4]?.signal.aborted).toBe(false);

    replacementOwner.dispose();
    publication.dispose();
    expect(registrations[0]?.signal.aborted).toBe(true);
    expect(registrations[4]?.signal.aborted).toBe(true);
  });

  it("cleans up partial publication when a tool registration fails", async () => {
    const signals: AbortSignal[] = [];
    const registerTool = vi.fn(
      async (_tool: PublishedTool, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        if (signals.length === 2) throw new Error("registration failed");
      }
    );
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    class FailingPage {
      readonly run = vi.fn();
    }
    registry.registerCompiledPom(FailingPage, {
      className: "FailingPage",
      tools: [action("run")],
      members: [],
      components: [],
    });
    const registration = registry.createPageRegistration(FailingPage);

    await expect(synchronizeWebMcpTools({ registerTool })).rejects.toThrow(
      "registration failed"
    );
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    registration.dispose();
    await flushPublisher();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("aborts publication while initial registration is pending", async () => {
    let finishRegistration: (() => void) | undefined;
    let registrationSignal: AbortSignal | undefined;
    let started!: () => void;
    const registrationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registerTool = vi.fn(
      async (_tool: PublishedTool, options: { signal: AbortSignal }) => {
        registrationSignal = options.signal;
        started();
        await new Promise<void>((resolve) => {
          finishRegistration = resolve;
        });
      }
    );
    vi.stubGlobal("document", { documentElement: {} });

    const { synchronizeWebMcpTools } = await import("./webMcp");
    const controller = new AbortController();
    const pending = synchronizeWebMcpTools(
      { registerTool },
      { signal: controller.signal }
    );
    await registrationStarted;

    controller.abort();
    expect(registrationSignal?.aborted).toBe(true);

    finishRegistration?.();
    const publication = await pending;
    publication.dispose();
  });

  it("cancels a pending bounded driver wait", async () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const { waitForWebMcpDriver } = await import("./webMcp");
    const controller = new AbortController();

    const driver = waitForWebMcpDriver(2_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await expect(driver).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("tool failure results", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.doUnmock("./pageContext");
    vi.unstubAllGlobals();
  });

  async function failWith(error: unknown) {
    const { withErrorResult } = await import("./webMcp");
    const tool = {
      name: "failing",
      execute: async () => {
        throw error;
      },
    };
    return withErrorResult(tool).execute({});
  }

  it("returns a successful result untouched", async () => {
    const { withErrorResult } = await import("./webMcp");
    const result = { page_changed: false, settled: true };
    const tool = {
      name: "succeeding",
      description: "Succeeds.",
      execute: vi.fn(async () => result),
    };

    const wrapped = withErrorResult(tool);

    expect(wrapped.name).toBe("succeeding");
    expect(wrapped.description).toBe("Succeeds.");
    await expect(wrapped.execute({ ref: "e1" })).resolves.toBe(result);
    expect(tool.execute).toHaveBeenCalledWith({ ref: "e1" });
  });

  it("renders an Ayme error as its name and message", async () => {
    const { RefResolutionError } = await import("./errors");

    await expect(
      failWith(new RefResolutionError('Cannot click ref "e2": removed.'))
    ).resolves.toEqual(
      toolFailure('RefResolutionError: Cannot click ref "e2": removed.')
    );
  });

  it("keeps a browser action error's full message, call log included", async () => {
    const error = new Error(
      "page.click: Timeout 1000ms exceeded.\nCall log:\n  - waiting for locator"
    );
    error.name = "TimeoutError";

    await expect(failWith(error)).resolves.toEqual(
      toolFailure(
        "TimeoutError: page.click: Timeout 1000ms exceeded.\nCall log:\n  - waiting for locator"
      )
    );
  });

  it("renders a plain Error as its message alone", async () => {
    await expect(failWith(new Error("boom"))).resolves.toEqual(
      toolFailure("boom")
    );
  });

  it("renders a thrown non-Error value as a string", async () => {
    await expect(failWith("not an error")).resolves.toEqual(
      toolFailure("not an error")
    );
    await expect(failWith(42)).resolves.toEqual(toolFailure("42"));
  });

  it("publishes every tool, get_page_context included, with failure results", async () => {
    // No Goal Loop is configured here; pursue_goal is covered in goalLoop.browser.test.ts.
    type ExecutableTool = PublishedTool & {
      execute(input: unknown): Promise<unknown>;
    };
    const tools: ExecutableTool[] = [];
    const registerTool = vi.fn(async (tool: ExecutableTool) => {
      tools.push(tool);
    });
    vi.doMock("./pageContext", async () => {
      const { ToolInputError } = await import("./errors");
      return {
        getPageContextTool: {
          name: "get_page_context",
          description: "Get page context.",
          inputSchema: { type: "object" },
          execute: async () => {
            throw new ToolInputError("POM definition names must be an array.");
          },
        },
      };
    });
    vi.stubGlobal("document", { documentElement: {} });

    const registry = await import("./registry");
    const { synchronizeWebMcpTools } = await import("./webMcp");
    registry.configureAymeRuntime({} as Page);

    class FailingPage {
      readonly run = vi.fn(() => {
        throw new Error("boom");
      });
      readonly items = [
        { root: brandedLocator({ count: async () => 1 }), archive: vi.fn() },
      ];
    }
    registry.registerCompiledPom(FailingPage, {
      className: "FailingPage",
      tools: [action("run")],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [
        {
          className: "Item",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("archive")],
        },
      ],
    });
    const registration = registry.createPageRegistration(FailingPage);
    const publication = await synchronizeWebMcpTools({ registerTool });
    const execute = (name: string, input: unknown) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return tool.execute(input);
    };

    await expect(execute("get_page_context", { names: "x" })).resolves.toEqual(
      toolFailure("ToolInputError: POM definition names must be an array.")
    );
    await expect(execute("run", {})).resolves.toEqual(toolFailure("boom"));
    await expect(execute("run", { extra: true })).resolves.toEqual(
      toolFailure(expect.stringMatching(/^ToolInputError: .*extra/))
    );
    await expect(
      execute("FailingPage.items.archive", { ref: "e404", args: {} })
    ).resolves.toEqual(
      toolFailure(expect.stringMatching(/^RefResolutionError: .*"e404"/))
    );

    publication.dispose();
    registration.dispose();
  });
});
