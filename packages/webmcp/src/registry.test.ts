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
  resolvePageStateRefs: async (_doc: unknown, ...refs: string[]) =>
    refs.map((ref) => {
      const entry = pageStateResolutions.get(ref);
      if (entry) return { status: "resolved", requestedRef: ref, ...entry };
      return { status: "unresolved", requestedRef: ref, reason: "unknown-ref" };
    }),
}));
vi.mock("./actionSequence", () => ({
  runAction: vi.fn(
    async (
      _doc: unknown,
      _caller: unknown,
      _call: unknown,
      perform: () => unknown
    ) => {
      const rawResult: unknown = await perform();
      const out: Record<string, unknown> = {
        page_changed: false,
        settled: true,
      };
      if (rawResult !== undefined) out.result = rawResult;
      return out;
    }
  ),
}));
import type { Page } from "@playwright/test";
import type { PomManifest } from "./contracts";

function brandedLocator(
  overrides: Record<string, unknown> = {},
  element: Element = { isConnected: true } as Element
) {
  const loc: Record<string | symbol, unknown> = { ...overrides };
  testLocators.add(loc);
  locatorElements.set(loc, [element]);
  return loc;
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as MutationObserver);
  }
}

const emptyManifest = (className: string): PomManifest => ({
  className,
  components: [],
  members: [],
  tools: [],
});

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

describe("live Page Object registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeMutationObserver.instances = [];
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows one runtime owner and permits a fresh owner after disposal", async () => {
    const registry = await import("./registry");
    const firstPage = {} as Page;
    const first = registry.createAymeRuntime(firstPage);

    expect(first.page).toBe(firstPage);
    expect(() => registry.createAymeRuntime({} as Page)).toThrow(
      "The Ayme runtime already has an active owner."
    );
    expect(() => registry.createAymeRuntime({} as Page)).toThrow(
      expect.objectContaining({ name: "RuntimeStateError", kind: "runtime" })
    );

    class OwnedPage {}
    registry.registerCompiledPom(OwnedPage, emptyManifest("OwnedPage"));
    registry.createPageRegistration(OwnedPage);
    expect(registry.listRegisteredPoms()).toHaveLength(1);

    first.dispose();
    expect(registry.listRegisteredPoms()).toHaveLength(0);
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).toHaveBeenCalledOnce();

    const secondPage = {} as Page;
    const second = registry.createAymeRuntime(secondPage);
    expect(second.page).toBe(secondPage);
    second.dispose();
  });

  it("observes while at least one Page Object is registered", async () => {
    const registry = await import("./registry");
    const page = {} as Page;
    registry.configureAymeRuntime(page);

    class FirstPage {
      constructor(readonly page: unknown) {}
    }
    class SecondPage {
      constructor(readonly page: unknown) {}
    }
    registry.registerCompiledPom(FirstPage, emptyManifest("FirstPage"));
    registry.registerCompiledPom(SecondPage, emptyManifest("SecondPage"));

    const first = registry.createPageRegistration(FirstPage);
    const second = registry.createPageRegistration(SecondPage);

    expect(first.instance).toBeInstanceOf(FirstPage);
    expect((first.instance as FirstPage).page).toBe(page);
    expect((second.instance as SecondPage).page).toBe(page);

    expect(FakeMutationObserver.instances).toHaveLength(1);
    expect(FakeMutationObserver.instances[0]?.observe).toHaveBeenCalledWith(
      document.documentElement,
      {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      }
    );
    expect(vi.getTimerCount()).toBe(1);

    first.dispose();
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).not.toHaveBeenCalled();

    second.dispose();
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces DOM mutations and ignores unchanged observations", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    const count = vi.fn(async () => 1);
    class PageWithLocator {
      readonly item = brandedLocator({ count });
    }
    registry.registerCompiledPom(PageWithLocator, {
      ...emptyManifest("PageWithLocator"),
      members: [{ memberName: "item", kind: "locator", access: "field" }],
    });
    const registration = registry.createPageRegistration(PageWithLocator);
    const subscriber = vi.fn();
    registry.subscribeToRegisteredPoms(subscriber);

    await vi.runOnlyPendingTimersAsync();
    expect(count).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledOnce();

    const observer = FakeMutationObserver.instances[0];
    observer?.trigger();
    observer?.trigger();
    observer?.trigger();
    expect(vi.getTimerCount()).toBe(1);

    await vi.runOnlyPendingTimersAsync();
    expect(count).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenCalledOnce();

    registration.dispose();
  });

  it("completes refreshes during continuous mutations without a probe backlog", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);
    const count = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 1;
    });
    class UpdatingPage {
      readonly item = brandedLocator({ count });
    }
    registry.registerCompiledPom(UpdatingPage, {
      ...emptyManifest("UpdatingPage"),
      members: [{ memberName: "item", kind: "locator", access: "field" }],
    });
    const registration = registry.createPageRegistration(UpdatingPage);
    const subscriber = vi.fn();
    const unsubscribe = registry.subscribeToRegisteredPoms(subscriber);
    const activity = setInterval(
      () => FakeMutationObserver.instances[0]?.trigger(),
      5
    );
    let finished = false;
    const refresh = Promise.all([
      registry.probeRegisteredPomMembers(),
      registry.probeRegisteredPomMembers(),
      registry.listRegisteredPomRoots(),
    ]).then(() => {
      finished = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(95);
      expect(finished).toBe(true);
      expect(subscriber).toHaveBeenCalledOnce();
      expect(count.mock.calls.length).toBeLessThanOrEqual(4);
      clearInterval(activity);
      await vi.advanceTimersByTimeAsync(100);
      const completedPasses = count.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200);
      expect(count).toHaveBeenCalledTimes(completedPasses);
      await refresh;
    } finally {
      clearInterval(activity);
      unsubscribe();
      registration.dispose();
    }
  });

  it("schedules an initial probe for every added Page Object", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    class FirstPage {}
    registry.registerCompiledPom(FirstPage, emptyManifest("FirstPage"));
    const first = registry.createPageRegistration(FirstPage);
    await vi.runOnlyPendingTimersAsync();

    const count = vi.fn(async () => 1);
    class LaterPage {
      readonly item = brandedLocator({ count });
    }
    registry.registerCompiledPom(LaterPage, {
      ...emptyManifest("LaterPage"),
      members: [{ memberName: "item", kind: "locator", access: "field" }],
    });
    const later = registry.createPageRegistration(LaterPage);

    expect(vi.getTimerCount()).toBe(1);
    await vi.runOnlyPendingTimersAsync();
    expect(count).toHaveBeenCalledOnce();

    first.dispose();
    later.dispose();
  });

  it("keeps same-class registrations independent", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    class ReusedPage {}
    registry.registerCompiledPom(ReusedPage, emptyManifest("ReusedPage"));

    const first = registry.createPageRegistration(ReusedPage);
    const second = registry.createPageRegistration(ReusedPage);

    expect(registry.listRegisteredPoms()).toHaveLength(2);
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "ReusedPage",
      "ReusedPage",
    ]);

    first.dispose();
    expect(registry.listRegisteredPoms()).toHaveLength(1);
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).not.toHaveBeenCalled();

    second.dispose();
    expect(registry.listRegisteredPoms()).toHaveLength(0);
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).toHaveBeenCalledOnce();
  });

  it("reports an observation error for a manifest-declared locator without a brand", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    class UnbrandedLocatorPage {
      readonly link = { count: async () => 1 };
    }
    registry.registerCompiledPom(UnbrandedLocatorPage, {
      ...emptyManifest("UnbrandedLocatorPage"),
      members: [{ memberName: "link", kind: "locator", access: "field" }],
    });
    const registration = registry.createPageRegistration(UnbrandedLocatorPage);

    await vi.runOnlyPendingTimersAsync();

    const poms = registry.listRegisteredPoms();
    const observations = poms[0]?.memberObservations ?? [];
    const linkObs = observations.find((o) => o.memberName === "link");
    expect(linkObs).toBeDefined();
    expect(linkObs?.count).toBe(0);
    expect(linkObs?.error).toMatch(/not a browser locator/);

    registration.dispose();
  });

  it("keeps tools inactive when a manifest-declared root is missing", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    class MissingRootPage {
      readonly save = vi.fn();
    }
    registry.registerCompiledPom(MissingRootPage, {
      ...emptyManifest("MissingRootPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    const registration = registry.createPageRegistration(MissingRootPage);

    await vi.runOnlyPendingTimersAsync();

    expect(registry.listRegisteredTools()).toEqual([]);

    registration.dispose();
  });

  it("bounds recursive component manifests to the current component path", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    class RecursivePage {
      readonly node = {
        root: brandedLocator({ count: async () => 1 }),
        open: vi.fn(),
      };
    }
    registry.registerCompiledPom(RecursivePage, {
      className: "RecursivePage",
      tools: [],
      members: [
        {
          memberName: "node",
          kind: "component",
          access: "field",
          componentClassName: "Node",
          collection: false,
        },
      ],
      components: [
        {
          className: "Node",
          members: [
            { memberName: "root", kind: "locator", access: "field" },
            {
              memberName: "child",
              kind: "component",
              access: "field",
              componentClassName: "Node",
              collection: false,
            },
          ],
          tools: [action("open")],
        },
      ],
    });

    const registration = registry.createPageRegistration(RecursivePage);
    await vi.runOnlyPendingTimersAsync();

    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "RecursivePage.node.open",
    ]);

    registration.dispose();
  });

  it("lists tools for live singular and nested component roots", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    let dialogRootCount = 1;
    let panelRootCount = 0;
    const confirm = vi.fn();
    const save = vi.fn();
    class NestedPage {
      readonly dialog = {
        root: brandedLocator({ count: async () => dialogRootCount }),
        confirm,
        panel: {
          root: brandedLocator({ count: async () => panelRootCount }),
          save,
        },
      };
    }
    registry.registerCompiledPom(NestedPage, {
      className: "NestedPage",
      tools: [],
      members: [
        {
          memberName: "dialog",
          kind: "component",
          access: "field",
          componentClassName: "Dialog",
          collection: false,
        },
      ],
      components: [
        {
          className: "Dialog",
          members: [
            { memberName: "root", kind: "locator", access: "field" },
            {
              memberName: "panel",
              kind: "component",
              access: "field",
              componentClassName: "Panel",
              collection: false,
            },
          ],
          tools: [action("confirm")],
        },
        {
          className: "Panel",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("save")],
        },
      ],
    });
    const registration = registry.createPageRegistration(NestedPage);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "NestedPage.dialog.confirm",
    ]);

    const confirmTool = registry.listRegisteredTools()[0];
    await confirmTool?.execute({});
    expect(confirm).toHaveBeenCalledOnce();

    panelRootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "NestedPage.dialog.confirm",
      "NestedPage.dialog.panel.save",
    ]);

    const nestedTool = registry.listRegisteredTools()[1];
    await nestedTool?.execute({});
    expect(save).toHaveBeenCalledOnce();

    dialogRootCount = 0;
    panelRootCount = 0;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools()).toHaveLength(0);

    registration.dispose();
  });

  it("lists collection tools only for their direct live roots", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    let rootCount = 0;
    class ItemsPage {
      readonly addItem = vi.fn();
      readonly items = [
        {
          root: brandedLocator({ count: async () => rootCount }),
          child: { root: brandedLocator({ count: async () => 1 }) },
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
          members: [
            { memberName: "root", kind: "locator", access: "field" },
            {
              memberName: "child",
              kind: "component",
              access: "field",
              componentClassName: "Child",
              collection: false,
            },
          ],
          tools: [action("archive")],
        },
        {
          className: "Child",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [],
        },
      ],
    });
    const registration = registry.createPageRegistration(ItemsPage);

    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "addItem",
    ]);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "addItem",
    ]);

    rootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "addItem",
      "ItemsPage.items.archive",
    ]);

    rootCount = 0;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredTools().map(({ name }) => name)).toEqual([
      "addItem",
    ]);

    registration.dispose();
  });

  it("resolves method-backed collections from the current returned array", async () => {
    const registry = await import("./registry");
    registry.configureAymeRuntime({} as Page);

    const firstElement = { isConnected: true } as Element;
    const secondElement = { isConnected: true } as Element;
    const replacementElement = { isConnected: true } as Element;
    const firstArchive = vi.fn(() => "first");
    const secondArchive = vi.fn(() => "second");
    const replacementArchive = vi.fn(() => "replacement");
    const first = {
      root: brandedLocator({ count: async () => 1 }, firstElement),
      archive: firstArchive,
    };
    const second = {
      root: brandedLocator({ count: async () => 1 }, secondElement),
      archive: secondArchive,
    };
    const replacement = {
      root: brandedLocator({ count: async () => 1 }, replacementElement),
      archive: replacementArchive,
    };
    pageStateResolutions.set("e2", {
      node: { ref: "e2", element: secondElement },
    });
    pageStateResolutions.set("e3", {
      node: { ref: "e3", element: replacementElement },
    });
    let currentItems = [first, second];
    const getItems = vi.fn(async () => currentItems.slice());
    class ItemsPage {
      readonly items = getItems;
    }

    registry.registerCompiledPom(ItemsPage, {
      className: "ItemsPage",
      tools: [],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "method",
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
    const registration = registry.createPageRegistration(ItemsPage);

    await vi.runOnlyPendingTimersAsync();
    const tool = registry.listRegisteredTools()[0];
    if (!tool) throw new Error("Expected a collection tool.");

    await expect(tool.execute({ ref: "e2", args: {} })).resolves.toEqual({
      page_changed: false,
      settled: true,
      result: "second",
    });
    expect(secondArchive).toHaveBeenCalledOnce();
    expect(firstArchive).not.toHaveBeenCalled();

    currentItems = [replacement];
    await expect(tool.execute({ ref: "e3", args: {} })).resolves.toEqual({
      page_changed: false,
      settled: true,
      result: "replacement",
    });
    expect(replacementArchive).toHaveBeenCalledOnce();
    expect(getItems).toHaveBeenCalledTimes(3);

    registration.dispose();
    pageStateResolutions.clear();
  });
});
