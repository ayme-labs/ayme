import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runContext } from "./agentCalls.testSupport";

const {
  locatorElements,
  testLocators,
  pageStateResolutions,
  pageStateRecordedListeners,
  pageObjectStructure,
} = vi.hoisted(() => ({
  pageObjectStructure: { source: undefined as unknown },
  locatorElements: new WeakMap<object, Element[]>(),
  testLocators: new WeakSet<object>(),
  pageStateRecordedListeners: new Set<() => void>(),
  pageStateResolutions: new Map<
    string,
    { node: { ref: string; element: Element } }
  >(),
}));
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
  onPageStateRecorded: (_doc: unknown, listener: () => void) => {
    pageStateRecordedListeners.add(listener);
    return () => pageStateRecordedListeners.delete(listener);
  },
  providePageObjectStructure: (source: unknown) => {
    pageObjectStructure.source = source;
  },
}));
vi.mock("./actionSequence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actionSequence")>()),
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
import type { Locator, Page } from "@playwright/test";
import type { PomManifest } from "./contracts";
import type { AymePage } from "./runtime";
import type { TestSession } from "./session.testSupport";

function brandedLocator(
  overrides: Record<string, unknown> = {},
  element: Element = { isConnected: true } as Element
) {
  const loc: Record<string | symbol, unknown> = { ...overrides };
  testLocators.add(loc);
  locatorElements.set(loc, [element]);
  return loc as unknown as Locator;
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
  parameters: [],
  returnPoms: [],
});

let started: TestSession | undefined;

/** Imports a fresh registry and starts a session on a page of its own. */
async function setup() {
  const registry = await import("./registry");
  const { startSession } = await import("./session.testSupport");
  // The decorators the registry reads: the module reset makes them fresh too.
  const { ayme } = await import("./decorators");
  const { rootOf, rooted } = await import("./pomRoot.testSupport");
  const session = startSession({} as AymePage);
  started = session;
  return { registry, session, ayme, rootOf, rooted };
}

describe("live Page Object registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeMutationObserver.instances = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    started?.stop();
    started = undefined;
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
      expect.objectContaining({
        name: "RuntimeStateError",
        kind: "runtime",
        code: "active-owner",
      })
    );

    class OwnedPage {}
    registry.registerCompiledPom(OwnedPage, emptyManifest("OwnedPage"));
    registry.registerPageObject(OwnedPage, new OwnedPage());
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
    const { registry, session } = await setup();

    class FirstPage {
      constructor(readonly page: unknown) {}
    }
    class SecondPage {
      constructor(readonly page: unknown) {}
    }
    registry.registerCompiledPom(FirstPage, emptyManifest("FirstPage"));
    registry.registerCompiledPom(SecondPage, emptyManifest("SecondPage"));

    const first = session.register(FirstPage);
    const second = session.register(SecondPage);

    expect(first).toBeInstanceOf(FirstPage);
    expect(first.page).toBeDefined();
    expect(second.page).toBe(first.page);

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

    session.unregister(FirstPage);
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).not.toHaveBeenCalled();

    session.unregister(SecondPage);
    expect(
      FakeMutationObserver.instances[0]?.disconnect
    ).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives page state its Page Object Roots only while a Page Object is registered", async () => {
    const { registry, session } = await setup();
    class FirstPage {}
    registry.registerCompiledPom(FirstPage, emptyManifest("FirstPage"));

    session.register(FirstPage);
    expect(pageObjectStructure.source).toBe(registry.getRegisteredPomStructure);

    session.unregister(FirstPage);
    expect(pageObjectStructure.source).toBeUndefined();
  });

  it("coalesces DOM mutations and ignores unchanged observations", async () => {
    const { registry, session } = await setup();

    const count = vi.fn(async () => 1);
    class PageWithLocator {
      readonly item = brandedLocator({ count });
    }
    registry.registerCompiledPom(PageWithLocator, {
      ...emptyManifest("PageWithLocator"),
      members: [{ memberName: "item", kind: "locator", access: "field" }],
    });
    session.register(PageWithLocator);
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
  });

  it("completes refreshes during continuous mutations without a probe backlog", async () => {
    const { registry, session } = await setup();
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
    session.register(UpdatingPage);
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
    }
  });

  it("schedules an initial probe for every added Page Object", async () => {
    const { registry, session } = await setup();

    class FirstPage {}
    registry.registerCompiledPom(FirstPage, emptyManifest("FirstPage"));
    session.register(FirstPage);
    await vi.runOnlyPendingTimersAsync();

    const count = vi.fn(async () => 1);
    class LaterPage {
      readonly item = brandedLocator({ count });
    }
    registry.registerCompiledPom(LaterPage, {
      ...emptyManifest("LaterPage"),
      members: [{ memberName: "item", kind: "locator", access: "field" }],
    });
    session.register(LaterPage);

    expect(vi.getTimerCount()).toBe(1);
    await vi.runOnlyPendingTimersAsync();
    expect(count).toHaveBeenCalledOnce();
  });

  it("rejects a distinct class whose name is already registered", async () => {
    const { registry, session } = await setup();

    // Two bundles can each compile their own Dialog with the same definition.
    const manifest = (): PomManifest => ({
      ...emptyManifest("Dialog"),
      tools: [{ ...action("confirm"), toolName: "Dialog.confirm" }],
    });
    const FirstDialog = class Dialog {
      confirm() {}
    };
    const SecondDialog = class Dialog {
      confirm() {}
    };
    registry.registerCompiledPom(FirstDialog, manifest());
    registry.registerCompiledPom(SecondDialog, manifest());

    session.register(FirstDialog);
    await vi.runOnlyPendingTimersAsync();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(SecondDialog);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "RuntimeStateError",
        code: "same-named-class",
        message:
          'Cannot register the Page Object "Dialog": a different class with that name is already registered.',
      })
    );
    expect(
      registry.listRegisteredPoms().map(({ instance }) => instance.constructor)
    ).toEqual([FirstDialog]);
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Dialog.confirm",
    ]);

    // The refused registration waits, and gets in once the other class is
    // gone, without being logged again.
    session.unregister(FirstDialog);
    expect(
      registry.listRegisteredPoms().map(({ instance }) => instance.constructor)
    ).toEqual([SecondDialog]);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("rejects a Page Object reaching a different class with a reached name", async () => {
    const { registry, session } = await setup();

    const reachingRow = (className: string, rowFile: string): PomManifest => ({
      ...emptyManifest(className),
      members: [
        {
          memberName: "rows",
          kind: "component",
          access: "field",
          componentClassName: "Row",
          collection: true,
        },
      ],
      components: [{ className: "Row", file: rowFile, members: [], tools: [] }],
    });
    class OrdersPage {}
    class UsersPage {}
    class InvoicesPage {}
    registry.registerCompiledPom(
      OrdersPage,
      reachingRow("OrdersPage", "src/orders/Row.ts")
    );
    registry.registerCompiledPom(
      UsersPage,
      reachingRow("UsersPage", "src/users/Row.ts")
    );
    registry.registerCompiledPom(
      InvoicesPage,
      reachingRow("InvoicesPage", "src/orders/Row.ts")
    );

    session.register(OrdersPage);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(UsersPage);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "RuntimeStateError",
        code: "same-named-class",
        message:
          'Cannot register the Page Object "UsersPage": it reaches a class named "Row" that differs from the one the Page Object "OrdersPage" reaches, declared in src/orders/Row.ts and src/users/Row.ts. Ayme tells the classes of Page Objects apart by name.',
      })
    );
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "OrdersPage",
    ]);

    session.register(InvoicesPage);
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "OrdersPage",
      "InvoicesPage",
    ]);

    // Unregistering releases the name. InvoicesPage reaches the same Row
    // as OrdersPage, so UsersPage waits for both.
    session.unregister(OrdersPage);
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "InvoicesPage",
    ]);
    session.unregister(InvoicesPage);
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "UsersPage",
    ]);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("rejects a Page Object that reaches two different classes with one name", async () => {
    const { registry, session } = await setup();

    class Row {}
    registry.registerCompiledPom(Row, {
      ...emptyManifest("Row"),
      components: [{ className: "Row", members: [], tools: [action("open")] }],
    });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(Row);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "same-named-class",
        message:
          'Cannot register the Page Object "Row": it reaches two different classes named "Row". Ayme tells the classes of Page Objects apart by name.',
      })
    );
    expect(registry.listRegisteredPoms()).toEqual([]);
    logged.mockRestore();
  });

  it("lets an HMR update of a shared child remount its Page Objects one by one", async () => {
    const { registry, session } = await setup();

    const compile = (className: string, rowTool: string, rowFile: string) => {
      const PomClass = { [className]: class {} }[className]!;
      registry.registerCompiledPom(PomClass, {
        ...emptyManifest(className),
        components: [
          {
            className: "Row",
            file: rowFile,
            members: [],
            tools: [{ ...action(rowTool), toolName: `Row.${rowTool}` }],
          },
        ],
      });
      return PomClass;
    };
    const Orders = compile("OrdersPage", "open", "src/Row.ts");
    const Invoices = compile("InvoicesPage", "open", "src/Row.ts");
    session.register(Orders);
    session.register(Invoices);

    // Editing Row gives it a new tool. OrdersPage remounts with it while
    // InvoicesPage still holds the old Row, from the same file.
    session.unregister(Orders);
    const UpdatedOrders = compile("OrdersPage", "remove", "src/Row.ts");
    session.register(UpdatedOrders);
    const registered = () =>
      registry.listRegisteredPoms().map(({ instance }) => instance.constructor);
    expect(registered()).toEqual([Invoices, UpdatedOrders]);

    // A Row from another file still clashes.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(compile("UsersPage", "open", "src/users/Row.ts"));
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "same-named-class",
        message: expect.stringContaining(
          'Cannot register the Page Object "UsersPage": it reaches a class named "Row" that differs from the one the Page Object "InvoicesPage" reaches, declared in src/Row.ts and src/users/Row.ts.'
        ),
      })
    );
    expect(registered()).toEqual([Invoices, UpdatedOrders]);
    logged.mockRestore();
  });

  it("compares a reached class with every same-named class, not the first", async () => {
    const { registry, session } = await setup();

    const reachingRow = (className: string, rowFile?: string) => {
      const PomClass = { [className]: class {} }[className]!;
      registry.registerCompiledPom(PomClass, {
        ...emptyManifest(className),
        components: [
          {
            className: "Row",
            ...(rowFile === undefined ? {} : { file: rowFile }),
            members: [],
            tools: [],
          },
        ],
      });
      return PomClass;
    };
    // A manifest without a file matches both Rows by shape.
    session.register(reachingRow("LegacyPage"));
    session.register(reachingRow("OrdersPage", "src/orders/Row.ts"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(reachingRow("UsersPage", "src/users/Row.ts"));
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "same-named-class",
        message: expect.stringContaining(
          'it reaches a class named "Row" that differs from the one the Page Object "OrdersPage" reaches, declared in src/orders/Row.ts and src/users/Row.ts.'
        ),
      })
    );
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "LegacyPage",
      "OrdersPage",
    ]);
    logged.mockRestore();
  });

  it("keeps a Page Object waiting when the registered ones stop matching each other", async () => {
    const { registry, session } = await setup();

    const reaching = (
      className: string,
      ...components: { className: string; file?: string; description: string }[]
    ) => {
      const PomClass = { [className]: class {} }[className]!;
      registry.registerCompiledPom(PomClass, {
        ...emptyManifest(className),
        components: components.map((component) => ({
          ...component,
          members: [],
          tools: [],
        })),
      });
      return PomClass;
    };
    // An HMR update of Row: one file, two shapes, so A and B match by file.
    const A = reaching("A", {
      className: "Row",
      file: "src/Row.ts",
      description: "old",
    });
    const B = reaching("B", {
      className: "Row",
      file: "src/Row.ts",
      description: "new",
    });
    // C's Row has no file, so it matches A's Row by shape.
    const C = reaching(
      "C",
      { className: "Row", description: "old" },
      { className: "Badge", description: "open" }
    );
    const D = reaching("D", { className: "Badge", description: "remove" });
    session.register(A);
    session.register(B);
    session.register(C);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(D);
    expect(logged).toHaveBeenCalledOnce();
    // Without A, C's Row no longer matches B's, but D still clashes with
    // C's Badge.
    session.unregister(A);
    expect(registry.listRegisteredPoms().map(({ id }) => id)).toEqual([
      "B",
      "C",
    ]);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("names both files when two top-level Page Objects share a name", async () => {
    const { registry, session } = await setup();

    const FirstDialog = class Dialog {};
    const SecondDialog = class Dialog {};
    registry.registerCompiledPom(FirstDialog, {
      ...emptyManifest("Dialog"),
      file: "src/a/Dialog.ts",
    });
    registry.registerCompiledPom(SecondDialog, {
      ...emptyManifest("Dialog"),
      file: "src/b/Dialog.ts",
    });
    session.register(FirstDialog);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(SecondDialog);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "same-named-class",
        message:
          'Cannot register the Page Object "Dialog": a different class with that name is already registered, declared in src/a/Dialog.ts and src/b/Dialog.ts.',
      })
    );
    expect(
      registry.listRegisteredPoms().map(({ instance }) => instance.constructor)
    ).toEqual([FirstDialog]);
    logged.mockRestore();
  });

  it("registers an HMR-updated Page Object after its old class is gone", async () => {
    const { registry, session } = await setup();

    const OldPage = class SettingsPage {};
    const NewPage = class SettingsPage {};
    registry.registerCompiledPom(OldPage, emptyManifest("SettingsPage"));
    registry.registerCompiledPom(NewPage, {
      ...emptyManifest("SettingsPage"),
      tools: [{ ...action("save"), toolName: "SettingsPage.save" }],
    });

    session.register(OldPage);
    session.unregister(OldPage);
    session.register(NewPage);
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "SettingsPage.save",
    ]);
  });

  it("reports an observation error for a manifest-declared locator without a brand", async () => {
    const { registry, session } = await setup();

    class UnbrandedLocatorPage {
      readonly link = { count: async () => 1 };
    }
    registry.registerCompiledPom(UnbrandedLocatorPage, {
      ...emptyManifest("UnbrandedLocatorPage"),
      members: [{ memberName: "link", kind: "locator", access: "field" }],
    });
    session.register(UnbrandedLocatorPage);

    await vi.runOnlyPendingTimersAsync();

    const poms = registry.listRegisteredPoms();
    const observations = poms[0]?.memberObservations ?? [];
    const linkObs = observations.find((o) => o.memberName === "link");
    expect(linkObs).toBeDefined();
    expect(linkObs?.count).toBe(0);
    expect(linkObs?.error).toMatch(/not a browser locator/);
  });

  it("lists no Page Object's tools before its first observation, whatever its kind", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class RootedPage {
      readonly root = brandedLocator({ count: async () => 1 });
      save() {}
    }
    ayme({ root: rootOf })(RootedPage);
    class RootlessPage {
      open() {}
    }
    class PredicatePage {
      close() {}
    }
    ayme.action({ available: () => "Nothing to close" })(
      PredicatePage.prototype,
      "close",
      Object.getOwnPropertyDescriptor(PredicatePage.prototype, "close")!
    );
    registry.registerCompiledPom(RootedPage, {
      ...emptyManifest("RootedPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    registry.registerCompiledPom(RootlessPage, {
      ...emptyManifest("RootlessPage"),
      tools: [action("open")],
    });
    registry.registerCompiledPom(PredicatePage, {
      ...emptyManifest("PredicatePage"),
      tools: [action("close")],
    });
    session.register(RootedPage);
    session.register(RootlessPage);
    session.register(PredicatePage);
    const listed = () =>
      registry
        .listRegisteredPomTools()
        .map(({ tool, present, available, reason }) => [
          tool.name,
          { present, available, reason },
        ]);

    expect(listed()).toEqual([
      ["save", { present: false, available: false, reason: undefined }],
      ["open", { present: false, available: false, reason: undefined }],
      ["close", { present: false, available: false, reason: undefined }],
    ]);

    await vi.runOnlyPendingTimersAsync();
    expect(listed()).toEqual([
      ["save", { present: true, available: true, reason: undefined }],
      ["open", { present: true, available: true, reason: undefined }],
      [
        "close",
        { present: true, available: false, reason: "Nothing to close" },
      ],
    ]);
  });

  it("lists a Page Object's tools once its own observation completes, while another's is still pending", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class StuckPage {
      // A root that never answers how many elements it matches.
      readonly root = brandedLocator({ count: () => new Promise(() => {}) });
      save() {}
    }
    ayme({ root: rootOf })(StuckPage);
    class Toolbar {
      reset() {}
    }
    registry.registerCompiledPom(StuckPage, {
      ...emptyManifest("StuckPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    registry.registerCompiledPom(Toolbar, {
      ...emptyManifest("Toolbar"),
      tools: [action("reset")],
    });
    session.register(StuckPage);
    session.register(Toolbar);
    const listed = () =>
      registry
        .listRegisteredPomTools()
        .map(({ tool, present, available }) => [
          tool.name,
          { present, available },
        ]);

    await vi.runOnlyPendingTimersAsync();
    expect(listed()).toEqual([
      ["save", { present: false, available: false }],
      ["reset", { present: true, available: true }],
    ]);
  });

  it("ends a probe only once every observation has, even when a subscriber throws", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    let answering = false;
    const pendingCounts: ((count: number) => void)[] = [];
    class SlowPage {
      readonly root = brandedLocator({
        count: () =>
          answering
            ? Promise.resolve(1)
            : new Promise<number>((resolve) => pendingCounts.push(resolve)),
      });
      save() {}
    }
    ayme({ root: rootOf })(SlowPage);
    class Toolbar {
      reset() {}
    }
    registry.registerCompiledPom(SlowPage, {
      ...emptyManifest("SlowPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    registry.registerCompiledPom(Toolbar, {
      ...emptyManifest("Toolbar"),
      tools: [action("reset")],
    });
    session.register(SlowPage);
    session.register(Toolbar);
    const unsubscribe = registry.subscribeToRegisteredPoms(() => {
      throw new Error("subscriber failed");
    });

    let settled = false;
    const probe = registry.probeRegisteredPomMembers().finally(() => {
      settled = true;
    });
    probe.catch(() => {});
    await vi.waitFor(() =>
      expect(
        registry.listRegisteredPomTools().map(({ tool }) => tool.name)
      ).toContain("reset")
    );
    await vi.waitFor(() => expect(pendingCounts).not.toHaveLength(0));
    // Toolbar's commit made the subscriber throw; SlowPage is still observing.
    expect(settled).toBe(false);

    // SlowPage's root answers now, so its observation ends.
    answering = true;
    for (const answer of pendingCounts) answer(1);
    await expect(probe).rejects.toThrow("subscriber failed");

    unsubscribe();
  });

  it("keeps tools inactive when a declared root is missing", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class MissingRootPage {
      declare readonly root: Locator;
      readonly save = vi.fn();
    }
    ayme({ root: rootOf })(MissingRootPage);
    registry.registerCompiledPom(MissingRootPage, {
      ...emptyManifest("MissingRootPage"),
      tools: [action("save")],
    });
    session.register(MissingRootPage);

    await vi.runOnlyPendingTimersAsync();

    expect(registry.listAvailablePomTools()).toEqual([]);
    expect(
      registry
        .listRegisteredPomTools()
        .map(({ tool, available }) => [tool.name, available])
    ).toEqual([["save", false]]);
  });

  it("lists one tool per name, the available one when registrations share it", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class MissingRootPage {
      declare readonly root: Locator;
      readonly save = vi.fn();
    }
    ayme({ root: rootOf })(MissingRootPage);
    class RootlessPage {
      readonly save = vi.fn();
    }
    registry.registerCompiledPom(MissingRootPage, {
      ...emptyManifest("MissingRootPage"),
      tools: [action("save")],
    });
    registry.registerCompiledPom(RootlessPage, {
      ...emptyManifest("RootlessPage"),
      tools: [action("save")],
    });
    const missing = session.register(MissingRootPage);
    const rootless = session.register(RootlessPage);
    await vi.runOnlyPendingTimersAsync();

    const listed = registry.listRegisteredPomTools();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ available: true });
    await listed[0]!.tool.execute({}, runContext());
    expect(rootless.save).toHaveBeenCalledOnce();
    expect(missing.save).not.toHaveBeenCalled();
  });

  it("lists a shared tool name by the present registration, and by the available one among those", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class MissingRootPage {
      declare readonly root: Locator;
      save() {}
    }
    ayme({ root: rootOf })(MissingRootPage);
    class UnavailablePage {
      save() {}
    }
    class RootlessPage {
      save() {}
    }
    ayme.action({ available: () => "Nothing to save" })(
      UnavailablePage.prototype,
      "save",
      Object.getOwnPropertyDescriptor(UnavailablePage.prototype, "save")!
    );
    registry.registerCompiledPom(MissingRootPage, {
      ...emptyManifest("MissingRootPage"),
      tools: [action("save")],
    });
    for (const Class of [UnavailablePage, RootlessPage])
      registry.registerCompiledPom(Class, {
        ...emptyManifest(Class.name),
        tools: [action("save")],
      });
    const availability = () =>
      registry
        .listRegisteredPomTools()
        .map(({ present, available, reason }) => ({
          present,
          available,
          reason,
        }));

    session.register(MissingRootPage);
    session.register(UnavailablePage);
    await vi.runOnlyPendingTimersAsync();
    expect(availability()).toEqual([
      { present: true, available: false, reason: "Nothing to save" },
    ]);

    session.register(RootlessPage);
    await vi.runOnlyPendingTimersAsync();
    expect(availability()).toEqual([
      { present: true, available: true, reason: undefined },
    ]);
  });

  it("lists a root's tools absent once its element left the page, before the next probe", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    const element = { isConnected: true } as { isConnected: boolean };

    class RootedPage {
      readonly root = brandedLocator(
        { count: async () => 1 },
        element as Element
      );
      save() {}
    }
    ayme({ root: rootOf })(RootedPage);
    registry.registerCompiledPom(RootedPage, {
      ...emptyManifest("RootedPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    session.register(RootedPage);
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools()).toHaveLength(1);

    element.isConnected = false;
    expect(registry.listRegisteredPomTools()).toEqual([
      expect.objectContaining({ present: false, available: false }),
    ]);
  });

  it("does not notify when a probe observes the same present root again", async () => {
    const { registry, session, ayme, rootOf } = await setup();

    class RootedPage {
      readonly root = brandedLocator({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async () => ({ present: true, available: true }),
      });
      save() {}
    }
    ayme({ root: rootOf })(RootedPage);
    registry.registerCompiledPom(RootedPage, {
      ...emptyManifest("RootedPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    session.register(RootedPage);
    const subscriber = vi.fn();
    registry.subscribeToRegisteredPoms(subscriber);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listRegisteredPomTools()).toEqual([
      expect.objectContaining({ present: true, available: true }),
    ]);
    expect(subscriber).toHaveBeenCalledOnce();

    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(subscriber).toHaveBeenCalledOnce();
  });

  it("lists an obstructed root's tools unavailable, and reads them again when a page state may name what is in the way", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    const { measurePomRoot } = await import("./reachMeasurement");
    vi.mocked(measurePomRoot).mockResolvedValue({
      present: true,
      available: false,
      blocker: {} as Element,
    });

    class CoveredPage {
      readonly root = brandedLocator({ count: async () => 1 });
      save() {}
    }
    ayme({ root: rootOf })(CoveredPage);
    registry.registerCompiledPom(CoveredPage, {
      ...emptyManifest("CoveredPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    session.register(CoveredPage);
    const subscriber = vi.fn();
    registry.subscribeToRegisteredPoms(subscriber);
    await vi.runOnlyPendingTimersAsync();

    expect(registry.listRegisteredPomTools()).toEqual([
      expect.objectContaining({
        present: true,
        available: false,
        reason: "a click would not reach it",
      }),
    ]);
    subscriber.mockClear();
    for (const listener of pageStateRecordedListeners) listener();
    expect(subscriber).toHaveBeenCalledOnce();

    vi.mocked(measurePomRoot).mockReset();
  });

  it("bounds recursive component manifests to the current component path", async () => {
    const { registry, session, rooted } = await setup();

    class RecursivePage {
      readonly node = rooted(brandedLocator({ count: async () => 1 }), {
        open: vi.fn(),
      });
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

    session.register(RecursivePage);
    await vi.runOnlyPendingTimersAsync();

    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "RecursivePage.node.open",
    ]);
  });

  it("lists tools for live singular and nested component roots", async () => {
    const { registry, session, rooted } = await setup();

    let dialogRootCount = 1;
    let panelRootCount = 0;
    const confirm = vi.fn();
    const save = vi.fn();
    class NestedPage {
      readonly dialog = rooted(
        brandedLocator({ count: async () => dialogRootCount }),
        {
          confirm,
          panel: rooted(brandedLocator({ count: async () => panelRootCount }), {
            save,
          }),
        }
      );
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
    session.register(NestedPage);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "NestedPage.dialog.confirm",
    ]);

    const confirmTool = registry.listAvailablePomTools()[0];
    await confirmTool?.execute({}, runContext());
    expect(confirm).toHaveBeenCalledOnce();

    panelRootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "NestedPage.dialog.confirm",
      "NestedPage.dialog.panel.save",
    ]);

    const nestedTool = registry.listAvailablePomTools()[1];
    await nestedTool?.execute({}, runContext());
    expect(save).toHaveBeenCalledOnce();

    dialogRootCount = 0;
    panelRootCount = 0;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools()).toHaveLength(0);
  });

  it("lists collection tools as available only for their direct available roots", async () => {
    const { registry, session, rooted } = await setup();

    let rootCount = 0;
    class ItemsPage {
      readonly addItem = vi.fn();
      readonly items = [
        rooted(brandedLocator({ count: async () => rootCount }), {
          child: rooted(brandedLocator({ count: async () => 1 }), {}),
          archive: vi.fn(),
        }),
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
    session.register(ItemsPage);

    // Nothing is listed before the first observation has run.
    expect(registry.listAvailablePomTools()).toEqual([]);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "addItem",
    ]);
    const flags = () =>
      registry
        .listRegisteredPomTools()
        .map(({ tool, available }) => [tool.name, available]);
    // Every registered tool stays listed, flagged.
    expect(flags()).toEqual([
      ["addItem", true],
      ["ItemsPage.items.archive", false],
    ]);

    rootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "addItem",
      "ItemsPage.items.archive",
    ]);
    expect(flags()).toEqual([
      ["addItem", true],
      ["ItemsPage.items.archive", true],
    ]);

    rootCount = 0;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "addItem",
    ]);
  });

  it("resolves method-backed collections from the current returned array", async () => {
    const { registry, session, rooted } = await setup();

    const firstElement = { isConnected: true } as Element;
    const secondElement = { isConnected: true } as Element;
    const replacementElement = { isConnected: true } as Element;
    const firstArchive = vi.fn(() => "first");
    const secondArchive = vi.fn(() => "second");
    const replacementArchive = vi.fn(() => "replacement");
    const first = rooted(
      brandedLocator({ count: async () => 1 }, firstElement),
      { archive: firstArchive }
    );
    const second = rooted(
      brandedLocator({ count: async () => 1 }, secondElement),
      { archive: secondArchive }
    );
    const replacement = rooted(
      brandedLocator({ count: async () => 1 }, replacementElement),
      { archive: replacementArchive }
    );
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
    session.register(ItemsPage);

    await vi.runOnlyPendingTimersAsync();
    const tool = registry.listAvailablePomTools()[0];
    if (!tool) throw new Error("Expected a collection tool.");

    await expect(
      tool.execute({ ref: "e2", args: {} }, runContext())
    ).resolves.toEqual({
      page_changed: false,
      settled: true,
      result: "second",
    });
    expect(secondArchive).toHaveBeenCalledOnce();
    expect(firstArchive).not.toHaveBeenCalled();

    currentItems = [replacement];
    await registry.probeRegisteredPomMembers();
    await expect(
      tool.execute({ ref: "e3", args: {} }, runContext())
    ).resolves.toEqual({
      page_changed: false,
      settled: true,
      result: "replacement",
    });
    expect(replacementArchive).toHaveBeenCalledOnce();
    // Each observation read the collection once; the calls read nothing.
    expect(getItems).toHaveBeenCalledTimes(2);

    pageStateResolutions.clear();
  });

  it("refuses a collection call on an item the last observation did not find, rather than running it", async () => {
    const { registry, session, rooted } = await setup();

    const knownElement = { isConnected: true } as Element;
    const addedElement = { isConnected: true } as Element;
    const addedArchive = vi.fn();
    const items = [
      rooted(brandedLocator({ count: async () => 1 }, knownElement), {}),
    ];
    pageStateResolutions.set("e2", {
      node: { ref: "e2", element: addedElement },
    });
    class ItemsPage {
      readonly items = items;
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
    session.register(ItemsPage);
    await vi.runOnlyPendingTimersAsync();
    const tool = registry.listAvailablePomTools()[0];
    if (!tool) throw new Error("Expected a collection tool.");
    // Held by the Page Object since the last observation.
    items.push(
      rooted(brandedLocator({ count: async () => 1 }, addedElement), {
        archive: addedArchive,
      }) as never
    );

    await expect(
      tool.execute({ ref: "e2", args: {} }, runContext())
    ).rejects.toThrow(
      'Cannot call ItemsPage.items.archive on ref "e2": it is not an instance of Item at ItemsPage.items.'
    );
    expect(addedArchive).not.toHaveBeenCalled();

    pageStateResolutions.clear();
  });

  it("lets an instance tool omit args only when its action needs no input", async () => {
    const { registry, session, rooted } = await setup();

    const element = { isConnected: true } as Element;
    const archive = vi.fn(() => "archived");
    const rename = vi.fn();
    const item = rooted(brandedLocator({ count: async () => 1 }, element), {
      archive,
      pin: vi.fn(),
      rename,
    });
    pageStateResolutions.set("e2", { node: { ref: "e2", element } });
    class ItemsPage {
      readonly items = [item];
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
          tools: [
            action("archive"),
            {
              ...action("pin"),
              parameters: [
                { name: "top", optional: true, schema: { type: "boolean" } },
              ],
            },
            {
              ...action("rename"),
              parameters: [
                { name: "name", optional: false, schema: { type: "string" } },
              ],
            },
          ],
        },
      ],
    });
    session.register(ItemsPage);

    await vi.runOnlyPendingTimersAsync();
    const tool = (name: string) => {
      const found = registry
        .listAvailablePomTools()
        .find((candidate) => candidate.name === name);
      if (!found) throw new Error(`Expected ${name}.`);
      return found;
    };
    const archiveTool = tool("ItemsPage.items.archive");
    const renameTool = tool("ItemsPage.items.rename");

    expect(archiveTool.inputSchema.required).toEqual(["ref"]);
    await expect(
      archiveTool.execute({ ref: "e2" }, runContext())
    ).resolves.toMatchObject({ result: "archived" });
    expect(archive).toHaveBeenCalledOnce();

    expect(tool("ItemsPage.items.pin").inputSchema.required).toEqual(["ref"]);

    expect(renameTool.inputSchema.required).toEqual(["ref", "args"]);
    await expect(
      renameTool.execute({ ref: "e2" }, runContext())
    ).rejects.toThrow(/args/);
    expect(rename).not.toHaveBeenCalled();

    pageStateResolutions.clear();
  });
});
