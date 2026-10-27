import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runContext } from "../../test-utils/agentCalls.testSupport";
import { alwaysReaches } from "../../test-utils/reach.testSupport";
import { checkedToolInput } from "../../shared";
import type { PageStateSession, Reach } from "../../page-state/application";

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
vi.mock(
  "../../page-state/infrastructure/pageState",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    onPageStateRecorded: (_doc: unknown, listener: () => void) => {
      pageStateRecordedListeners.add(listener);
      return () => pageStateRecordedListeners.delete(listener);
    },
    providePageObjectStructure: (source: unknown) => {
      pageObjectStructure.source = source;
    },
  })
);
import type { Locator, Page } from "@playwright/test";
import type { PomManifest } from "../../shared";
import type { AymePage } from "../../runtime";
import type { TestSession } from "../../test-utils/session.testSupport";

/**
 * The Page State Session a Run hands these tools: a ref resolves to its
 * node in `pageStateResolutions`, and an action performs at once on a page
 * that never changes.
 */
const pageStateSession = {
  resolveRef: async (requested: string) => {
    const entry = pageStateResolutions.get(requested);
    if (!entry) throw new Error(`No page state resolution for "${requested}".`);
    return entry.node;
  },
  runAction: async (
    _cursor: unknown,
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
  },
} as unknown as PageStateSession;

/** The Run context these tools execute in, on a layout every click reaches. */
const pomRunContext = () =>
  runContext(undefined, undefined, pageStateSession, alwaysReaches());

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
  methodName: methodName.split(".").at(-1)!,
  toolName: methodName,
  description: methodName,
  parameters: [],
  returnPoms: [],
});

let started: TestSession | undefined;

/**
 * Imports a fresh registry and starts a session on a page of its own, which
 * measures reach with `reach`: a layout every click reaches by default.
 */
async function setup(reach: Reach = alwaysReaches()) {
  const registry = await import("./registry");
  const { startSession } = await import("../../test-utils/session.testSupport");
  // The decorators the registry reads: the module reset makes them fresh too.
  const { ayme } = await import("../domain/decorators");
  const { rootOf, rooted } =
    await import("../../test-utils/pomRoot.testSupport");
  const session = startSession({} as AymePage, { reach });
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
    const { createAymeRuntime } = await import("./aymeRuntime");
    const firstPage = {} as Page;
    const first = createAymeRuntime(firstPage);

    expect(first.page).toBe(firstPage);
    expect(() => createAymeRuntime({} as Page)).toThrow(
      "The Ayme runtime already has an active owner."
    );
    expect(() => createAymeRuntime({} as Page)).toThrow(
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
    const second = createAymeRuntime(secondPage);
    expect(second.page).toBe(secondPage);
    second.dispose();
  });

  it("names the uncompiled class when constructing or registering it", async () => {
    const registry = await import("./registry");
    class SignInPage {}
    const uncompiled = expect.objectContaining({
      name: "RuntimeStateError",
      message: "SignInPage has no compiler-derived Ayme metadata.",
    });

    expect(() => registry.constructPageObject(SignInPage, {} as Page)).toThrow(
      uncompiled
    );
    expect(() =>
      registry.registerPageObject(SignInPage, new SignInPage())
    ).toThrow(uncompiled);
  });

  it("labels an anonymous uncompiled class", async () => {
    const registry = await import("./registry");
    const Anonymous = (() => class {})();
    const message =
      "An anonymous page object class has no compiler-derived Ayme metadata.";

    expect(Anonymous.name).toBe("");
    expect(() => registry.constructPageObject(Anonymous, {} as Page)).toThrow(
      message
    );
    expect(() =>
      registry.registerPageObject(Anonymous, new Anonymous())
    ).toThrow(message);
  });

  it("labels an uncompiled class whose static name is not a string", async () => {
    const registry = await import("./registry");
    class SymbolNamed {}
    Object.defineProperty(SymbolNamed, "name", {
      value: Symbol("SignInPage"),
    });

    expect(() => registry.constructPageObject(SymbolNamed, {} as Page)).toThrow(
      expect.objectContaining({
        name: "RuntimeStateError",
        message:
          "An anonymous page object class has no compiler-derived Ayme metadata.",
      })
    );
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

  it("withholds a root-less class reached twice while keeping the other tools", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    class Shared {
      readonly root = brandedLocator();
      open() {}
    }
    class Page {
      first = new Shared();
      second = new Shared();
      save() {}
    }
    const shared = {
      ...emptyManifest("Shared"),
      tools: [action("Shared.open")],
    };
    registry.registerCompiledPom(Shared, shared);
    // A loaded class of the same name in another module has its own root
    // declaration. It is not reached by this registration.
    const OtherShared = class Shared {
      root = brandedLocator();
    };
    ayme({ root: rootOf })(OtherShared);
    registry.registerCompiledPom(OtherShared, {
      ...emptyManifest("Shared"),
      file: "other/Shared.ts",
    });
    registry.registerCompiledPom(Page, {
      ...emptyManifest("Page"),
      tools: [{ ...action("save"), toolName: "Page.save" }],
      members: ["first", "second"].map((memberName) => ({
        memberName,
        kind: "component" as const,
        access: "field" as const,
        componentClassName: "Shared",
        collection: false,
      })),
      components: [shared],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(Page);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "Shared" declares no root and is reached from more than one place: Page.first, Page.second.',
      })
    );
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Page.save",
    ]);
    class Unrelated {}
    registry.registerCompiledPom(Unrelated, emptyManifest("Unrelated"));
    session.register(Unrelated);
    expect(logged).toHaveBeenCalledOnce();
    session.stop();
    const { startSession } =
      await import("../../test-utils/session.testSupport");
    const restarted = startSession({} as AymePage, {
      reach: alwaysReaches(),
    });
    started = restarted;
    restarted.register(Page);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("withdraws a shared root-less class on the second registration and restores it after disposal", async () => {
    const { registry, session } = await setup();
    class Shared {
      open() {}
    }
    class First {
      child = new Shared();
      save() {}
    }
    class Second {
      child = new Shared();
      save() {}
    }
    const shared = {
      ...emptyManifest("Shared"),
      tools: [action("Shared.open")],
    };
    registry.registerCompiledPom(Shared, shared);
    for (const Model of [First, Second])
      registry.registerCompiledPom(Model, {
        ...emptyManifest(Model.name),
        tools: [{ ...action("save"), toolName: `${Model.name}.save` }],
        members: [
          {
            memberName: "child",
            kind: "component",
            access: "field",
            componentClassName: "Shared",
            collection: false,
          },
        ],
        components: [shared],
      });
    session.register(First);
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "First.save",
      "Shared.open",
    ]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(Second);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "Shared" declares no root and is reached from more than one place: First.child, Second.child.',
      })
    );
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "First.save",
      "Second.save",
    ]);
    session.unregister(Second);
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "First.save",
      "Shared.open",
    ]);
    logged.mockRestore();
  });

  it("refuses a root-less descendant of an empty collection and restores its tools after a rooted HMR replacement", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    let Child = class Child {
      root = brandedLocator({ count: async () => 1 });
      open() {}
    };
    class Item {
      root = brandedLocator({ count: async () => 1 });
      child = new Child();
      open() {}
    }
    ayme({ root: rootOf })(Item);
    class Page {
      items: Item[] = [];
    }
    const child = {
      ...emptyManifest("Child"),
      file: "Child.ts",
      tools: [action("Child.open")],
    };
    const item = {
      ...emptyManifest("Item"),
      members: [
        {
          memberName: "child",
          kind: "component" as const,
          access: "field" as const,
          componentClassName: "Child",
          collection: false,
        },
      ],
      tools: [action("Item.open")],
    };
    const manifest = {
      ...emptyManifest("Page"),
      members: [
        {
          memberName: "items",
          kind: "component" as const,
          access: "field" as const,
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [item, child],
    };
    registry.registerCompiledPom(Child, child);
    registry.registerCompiledPom(Item, { ...item, components: [child] });
    registry.registerCompiledPom(Page, manifest);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(Page);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "Child" declares no root and has many instances below a collection: Page.items[].child (below a collection).',
      })
    );
    await vi.runOnlyPendingTimersAsync();
    expect(
      registry.listRegisteredPomTools().map(({ tool }) => tool.name)
    ).toEqual(["Item.open"]);
    session.unregister(Page);
    Child = class Child {
      root = brandedLocator({ count: async () => 1 });
      open() {}
    };
    ayme({ root: rootOf })(Child);
    registry.registerCompiledPom(Child, { ...child });
    const UpdatedPage = class Page {
      items = [new Item()];
    };
    registry.registerCompiledPom(UpdatedPage, { ...manifest });
    session.register(UpdatedPage);
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Item.open",
      "Child.open",
    ]);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("allows repeated rooted classes with an inherited root and ignores action-return metadata", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    class Base {
      root = brandedLocator({ count: async () => 1 });
    }
    ayme({ root: rootOf })(Base);
    class Panel extends Base {
      open() {}
    }
    class Returned {
      open() {}
    }
    class Page {
      first = new Panel();
      second = new Panel();
      open() {}
    }
    const panel = { ...emptyManifest("Panel"), tools: [action("Panel.open")] };
    const returned = {
      ...emptyManifest("Returned"),
      tools: [action("Returned.open")],
    };
    registry.registerCompiledPom(Panel, panel);
    registry.registerCompiledPom(Returned, returned);
    registry.registerCompiledPom(Page, {
      ...emptyManifest("Page"),
      tools: [
        { ...action("open"), toolName: "Page.open", returnPoms: ["Returned"] },
      ],
      members: ["first", "second"].map((memberName) => ({
        memberName,
        kind: "component" as const,
        access: "field" as const,
        componentClassName: "Panel",
        collection: false,
      })),
      components: [panel, returned],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    session.register(Page);
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Page.open",
      "Panel.open",
    ]);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
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
      components: [
        { className: "Row", members: [], tools: [action("Row.open")] },
      ],
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
    const { registry, session, ayme, rootOf } = await setup(
      alwaysReaches({
        measurePomRoot: async () => ({
          present: true,
          available: false,
          blocker: {} as Element,
        }),
      })
    );

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
          tools: [action("Node.open")],
        },
      ],
    });

    session.register(RecursivePage);
    await vi.runOnlyPendingTimersAsync();

    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Node.open",
    ]);
  });

  it("lists tools for live singular and nested component roots", async () => {
    const { registry, session, rooted } = await setup();

    let dialogRootCount = 1;
    let panelRootCount = 0;
    const dialogElement = { isConnected: true } as Element;
    const panelElement = { isConnected: true } as Element;
    pageStateResolutions.set("e21", {
      node: { ref: "e21", element: dialogElement },
    });
    pageStateResolutions.set("e22", {
      node: { ref: "e22", element: panelElement },
    });
    const confirm = vi.fn();
    const save = vi.fn();
    class NestedPage {
      readonly dialog = rooted(
        brandedLocator({ count: async () => dialogRootCount }, dialogElement),
        {
          confirm,
          panel: rooted(
            brandedLocator({ count: async () => panelRootCount }, panelElement),
            {
              save,
            }
          ),
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
          tools: [action("Dialog.confirm")],
        },
        {
          className: "Panel",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("Panel.save")],
        },
      ],
    });
    session.register(NestedPage);

    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Dialog.confirm",
    ]);

    const confirmTool = registry.listAvailablePomTools()[0];
    await confirmTool?.execute({ ref: "e21" }, pomRunContext());
    expect(confirm).toHaveBeenCalledOnce();

    panelRootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "Dialog.confirm",
      "Panel.save",
    ]);

    const nestedTool = registry.listAvailablePomTools()[1];
    await nestedTool?.execute({ ref: "e22" }, pomRunContext());
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
      tools: [action("ItemsPage.addItem")],
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
          tools: [action("Item.archive")],
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
      "ItemsPage.addItem",
    ]);
    const flags = () =>
      registry
        .listRegisteredPomTools()
        .map(({ tool, available }) => [tool.name, available]);
    // Every registered tool stays listed, flagged.
    expect(flags()).toEqual([
      ["ItemsPage.addItem", true],
      ["Item.archive", false],
    ]);

    rootCount = 1;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "ItemsPage.addItem",
      "Item.archive",
    ]);
    expect(flags()).toEqual([
      ["ItemsPage.addItem", true],
      ["Item.archive", true],
    ]);

    rootCount = 0;
    FakeMutationObserver.instances[0]?.trigger();
    await vi.runOnlyPendingTimersAsync();
    expect(registry.listAvailablePomTools().map(({ name }) => name)).toEqual([
      "ItemsPage.addItem",
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
          tools: [action("Item.archive")],
        },
      ],
    });
    session.register(ItemsPage);

    await vi.runOnlyPendingTimersAsync();
    const tool = registry.listAvailablePomTools()[0];
    if (!tool) throw new Error("Expected a collection tool.");

    await expect(
      tool.execute({ ref: "e2", args: {} }, pomRunContext())
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
      tool.execute({ ref: "e3", args: {} }, pomRunContext())
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
          tools: [action("Item.archive")],
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
      tool.execute({ ref: "e2", args: {} }, pomRunContext())
    ).rejects.toThrow(
      'Cannot call Item.archive on ref "e2": it is not a root of Item.'
    );
    expect(addedArchive).not.toHaveBeenCalled();

    pageStateResolutions.clear();
  });

  it("refuses a call whose root no longer resolves to the one element the observation found, rather than running it", async () => {
    const { registry, session, ayme, rootOf } = await setup();
    const rootElement = { isConnected: true } as Element;
    const save = vi.fn();
    class RootedPage {
      readonly root = brandedLocator({ count: async () => 1 }, rootElement);
      save() {
        save();
      }
    }
    ayme({ root: rootOf })(RootedPage);
    registry.registerCompiledPom(RootedPage, {
      ...emptyManifest("RootedPage"),
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("save")],
    });
    const page = session.register(RootedPage);
    await vi.runOnlyPendingTimersAsync();
    const tool = registry.listAvailablePomTools()[0];
    if (!tool) throw new Error("Expected the Page Object Tool.");
    pageStateResolutions.set("e5", {
      node: { ref: "e5", element: rootElement },
    });
    // A second element now matches the root's locator, after the first.
    locatorElements.set(page.root, [
      rootElement,
      { isConnected: true } as Element,
    ]);

    await expect(
      tool.execute({ ref: "e5", args: {} }, pomRunContext())
    ).rejects.toThrow('RootedPage on ref "e5" is unavailable');
    expect(save).not.toHaveBeenCalled();

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
            action("Item.archive"),
            {
              ...action("Item.pin"),
              parameters: [
                { name: "top", optional: true, schema: { type: "boolean" } },
              ],
            },
            {
              ...action("Item.rename"),
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
    const archiveTool = tool("Item.archive");
    const renameTool = tool("Item.rename");

    expect(archiveTool.inputSchema.required).toEqual(["ref"]);
    await expect(
      archiveTool.execute({ ref: "e2" }, pomRunContext())
    ).resolves.toMatchObject({ result: "archived" });
    expect(archive).toHaveBeenCalledOnce();

    expect(tool("Item.pin").inputSchema.required).toEqual(["ref"]);

    expect(renameTool.inputSchema.required).toEqual(["ref", "args"]);
    // The runtime checks a Run's input against this schema before execute.
    expect(() =>
      checkedToolInput(renameTool.inputSchema, { ref: "e2" })
    ).toThrow("Input property args is required.");

    pageStateResolutions.clear();
  });
});
