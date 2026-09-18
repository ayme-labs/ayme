import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { locatorElements, testLocators } = vi.hoisted(() => ({
  locatorElements: new WeakMap<object, Element[]>(),
  testLocators: new WeakSet<object>(),
}));
vi.mock("@ayme-dev/playwright-lite/internal", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@ayme-dev/playwright-lite/internal")
  >()),
  isPlaywrightLiteLocator: (value: unknown) =>
    typeof value === "object" && value !== null && testLocators.has(value),
  resolveLocatorElements: (value: object) => locatorElements.get(value) ?? [],
}));
import type { Page } from "@playwright/test";

function brandedLocator(overrides: Record<string, unknown> = {}) {
  const loc: Record<string | symbol, unknown> = { ...overrides };
  testLocators.add(loc);
  locatorElements.set(loc, [{ isConnected: true } as Element]);
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
    class ItemsPage {
      readonly items = [
        {
          root: brandedLocator({ count: async () => rootCount }),
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
      archive?.tool.execute({ index: 0, args: {} })
    ).resolves.toEqual({ ok: true });
    expect(archive?.signal.aborted).toBe(true);

    publication.dispose();
    pageRegistration.dispose();
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

    await expect(addItem?.execute({})).resolves.toEqual({ ok: true });
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
