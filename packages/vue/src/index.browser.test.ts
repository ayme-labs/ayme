import {
  createApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
  reactive,
  ref,
  type App,
  type Component,
} from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { createAyme } from "@ayme-dev/ayme";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";

vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createAyme: vi.fn(original.createAyme),
  };
});
import {
  AymeProvider,
  useAyme,
  usePageObject,
  usePeek,
  type UseAymeOptions,
} from "./index";

type PageFactory = NonNullable<UseAymeOptions["pageFactory"]>;
type Page = ReturnType<PageFactory>;
const page = { url: () => "factory page" } as unknown as Page;
const pageFactory: PageFactory = () => page;
class Model {
  constructor(readonly page: Page) {}
}
class ComplexModel {
  constructor(...args: [Page, object]) {
    void args;
  }
}
registerCompiledPom(Model, {
  className: "Model",
  components: [],
  members: [],
  tools: [],
});
const apps: App[] = [];
const scopes: ReturnType<typeof effectScope>[] = [];
function mount(component: Component) {
  const app = createApp(component);
  apps.push(app);
  app.mount(document.createElement("div"));
  return app;
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const scope of scopes.splice(0)) scope.stop();
  Reflect.deleteProperty(document, "modelContext");
  vi.mocked(createAyme).mockClear();
  vi.unstubAllGlobals();
});

it("C1: passes the page factory and ignore to the runtime session", () => {
  const ignore = (element: Element) => element.matches(".assistant");
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, ignore }));
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore,
    customTools: undefined,
    goalLoop: undefined,
  });
});

it("C1: passes customTools to the runtime session", () => {
  const customTools = [
    {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async () => null,
    },
  ];
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, customTools }));
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools,
    goalLoop: undefined,
  });
});

it("C1: passes goalLoop to the runtime session", () => {
  const goalLoop = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, goalLoop }));
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools: undefined,
    goalLoop,
  });
});

it("C1: passes webMCP to the runtime session", () => {
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() =>
    useAyme({
      pageFactory,
      webMCP: { enabled: false, toolNamePrefix: "ayme_" },
    })
  );
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools: undefined,
    goalLoop: undefined,
    webMCP: { enabled: false, toolNamePrefix: "ayme_" },
  });
});

// Records the options, then starts a session without the Inspector or the
// Agent Connection: the optional peers may not be built or installed where
// these tests run.
async function withoutInspectorLoad() {
  const { createAyme: actual } =
    await vi.importActual<typeof import("@ayme-dev/ayme")>("@ayme-dev/ayme");
  vi.mocked(createAyme).mockImplementationOnce((options) =>
    actual({ ...options, inspector: false, agentConnection: false })
  );
}

it("C1: passes inspector to the runtime session", async () => {
  await withoutInspectorLoad();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, inspector: true }));
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ inspector: true })
  );
});

it("C1: passes agentConnection to the runtime session", async () => {
  await withoutInspectorLoad();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, agentConnection: true }));
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ agentConnection: true })
  );
});

it("C1: passes navigate from the provider to the runtime session", () => {
  const navigate = vi.fn();
  mount({ render: () => h(AymeProvider, { pageFactory, navigate }) });
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ navigate })
  );
});

it("C1, C4: passes the provider's inspector demo setting and keeps it fixed across renders", async () => {
  await withoutInspectorLoad();
  const errors: unknown[] = [];
  const count = ref(0);
  const app = createApp({
    render: () =>
      h(
        AymeProvider,
        { pageFactory, inspector: { demo: true } },
        { default: () => count.value }
      ),
  });
  app.config.errorHandler = (error) => errors.push(error);
  app.config.warnHandler = (message) => errors.push(message);
  apps.push(app);
  app.mount(document.createElement("div"));

  count.value += 1;
  await nextTick();
  expect(errors).toEqual([]);
  expect(createAyme).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ inspector: { demo: true } })
  );
});

it("C11: returns the session as ayme, so a goal runs through it, and its webMCP member", async () => {
  const goalLoop = vi.fn(async () => {
    throw new Error("No decision.");
  });
  const scope = effectScope();
  scopes.push(scope);
  const { ayme, webMCP } = scope.run(() => useAyme({ pageFactory, goalLoop }))!;
  expect(ayme).toBe(vi.mocked(createAyme).mock.results[0]?.value);
  expect(webMCP.publicationStatus).toBe(ayme.webMCP.publicationStatus);
  expect(webMCP.retryPublication).toBe(ayme.webMCP.retryPublication);
  const handover = await ayme.tools.run("goal", {
    goal: "Save the form",
    maxSteps: 1,
  });
  expect(goalLoop).toHaveBeenCalledOnce();
  expect(handover.reason).toBe("decide_failed");
});

it("C2: calls the page factory once for the owner's runtime, on start", () => {
  const factory = vi.fn(pageFactory);
  const scope = effectScope();
  scopes.push(scope);
  const instance = scope.run(() => {
    useAyme({ pageFactory: factory });
    expect(factory).toHaveBeenCalledOnce();
    return usePageObject(Model);
  })!;
  expect(instance.page.url()).toBe(page.url());
  expect(factory).toHaveBeenCalledOnce();
});

it("C2, C6: preserves standalone effectScope setup, direct instance return and disposal", () => {
  const scope = effectScope();
  scopes.push(scope);
  const result = scope.run(() => {
    const runtime = useAyme({ pageFactory });
    const instance = usePageObject(Model);
    expectTypeOf(instance).toEqualTypeOf<Model>();
    return { runtime, instance };
  })!;
  expect(result.instance.page.url()).toBe(page.url());
  expect(result.runtime.webMCP.publicationStatus.state).toBe("disabled");
  expect(listRegisteredPoms()).toHaveLength(1);
  scope.stop();
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(result.runtime.webMCP.publicationStatus.state).toBe("disposed");
});

it("C7: requires a Vue scope and a single-argument constructor", () => {
  expect(() => useAyme()).toThrow("active Vue effect scope");
  expect(() => usePageObject(Model)).toThrow("active Vue effect scope");
  expectTypeOf(ComplexModel).not.toMatchTypeOf<
    Parameters<typeof usePageObject>[0]
  >();
});

it.each(["provider", "standalone"])(
  "C3, C6: shares the %s owner's page with descendants without transferring ownership",
  async (kind) => {
    const visible = ref(true);
    let instance: Model | undefined;
    let state: ReturnType<typeof useAyme> | undefined;
    const Child = defineComponent({
      setup() {
        state = useAyme();
        instance = usePageObject(Model);
        return () => null;
      },
    });
    const Root = defineComponent({
      setup() {
        if (kind === "standalone") useAyme({ pageFactory });
        const content = () => (visible.value ? h(Child) : null);
        return kind === "provider"
          ? () => h(AymeProvider, { pageFactory }, { default: content })
          : content;
      },
    });
    const app = mount(Root);
    expect(instance?.page.url()).toBe(page.url());
    expect(state?.webMCP.publicationStatus.state).toBe("disabled");
    expect(listRegisteredPoms()).toHaveLength(1);
    visible.value = false;
    await nextTick();
    expect(listRegisteredPoms()).toHaveLength(0);
    const scope = effectScope();
    scopes.push(scope);
    expect(() => scope.run(() => useAyme({ pageFactory }))).toThrow(
      "active owner"
    );
    visible.value = true;
    const previous = instance;
    await nextTick();
    // The session keeps one instance per class.
    expect(instance).toBe(previous);
    expect(listRegisteredPoms()).toHaveLength(1);
    app.unmount();
    expect(listRegisteredPoms()).toHaveLength(0);
  }
);

// C3 for useAyme: the page allows its options error to replace the
// nested-owner text, because the call is both owner and consumer.
it("C3: rejects child page and ignore options and nested providers", () => {
  const errors: unknown[] = [];
  const ignore = (element: Element) => element.matches(".assistant");
  const Child = defineComponent({
    setup() {
      try {
        useAyme({ pageFactory });
      } catch (error) {
        errors.push(error);
      }
      try {
        useAyme({ ignore });
      } catch (error) {
        errors.push(error);
      }
      return () => h(AymeProvider, { pageFactory });
    },
  });
  const app = createApp({
    render: () => h(AymeProvider, { pageFactory }, { default: () => h(Child) }),
  });
  app.config.errorHandler = (error) => errors.push(error);
  apps.push(app);
  app.mount(document.createElement("div"));
  expect(errors.map(String)).toEqual([
    expect.stringContaining("Configure Ayme's options on the ancestor"),
    expect.stringContaining("Configure Ayme's options on the ancestor"),
    expect.stringContaining("cannot be nested"),
  ]);
});

it("C5: creates the default page and reports real publication state to consumers", async () => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  let state: ReturnType<typeof useAyme> | undefined;
  let instance: Model | undefined;
  const Child = defineComponent({
    setup() {
      state = useAyme();
      instance = usePageObject(Model);
      return () => null;
    },
  });
  const app = mount({
    render: () =>
      h(
        AymeProvider,
        { webMCP: { enabled: true } },
        { default: () => h(Child) }
      ),
  });
  expect(typeof instance?.page.getByRole).toBe("function");
  await state?.webMCP.retryPublication();
  expect(state?.webMCP.publicationStatus.state).toBe("active");
  app.unmount();
});

it("C4: rejects changing a mounted provider's options", async () => {
  const errors: unknown[] = [];
  const prefix = ref("ayme_");
  const app = createApp({
    render: () =>
      h(AymeProvider, {
        pageFactory,
        webMCP: { enabled: false, toolNamePrefix: prefix.value },
      }),
  });
  app.config.errorHandler = (error) => errors.push(error);
  apps.push(app);
  app.mount(document.createElement("div"));
  expect(errors).toEqual([]);

  prefix.value = "other_";
  await nextTick();
  expect(errors.map(String)).toEqual([
    expect.stringContaining(
      "The provider options must stay fixed while mounted"
    ),
  ]);
});

it("C4: changes the options when the provider is remounted", async () => {
  const errors: unknown[] = [];
  const mounted = ref(true);
  const prefix = ref("ayme_");
  const app = createApp({
    render: () =>
      mounted.value
        ? h(AymeProvider, {
            pageFactory,
            webMCP: { enabled: false, toolNamePrefix: prefix.value },
          })
        : null,
  });
  app.config.errorHandler = (error) => errors.push(error);
  apps.push(app);
  app.mount(document.createElement("div"));

  mounted.value = false;
  await nextTick();
  prefix.value = "other_";
  mounted.value = true;
  await nextTick();
  expect(errors).toEqual([]);
  expect(createAyme).toHaveBeenLastCalledWith(
    expect.objectContaining({
      webMCP: { enabled: false, toolNamePrefix: "other_" },
    })
  );
});

it("C3: rejects a second owner while the first is active", () => {
  const first = effectScope();
  scopes.push(first);
  first.run(() => useAyme({ pageFactory }));
  const second = effectScope();
  scopes.push(second);
  expect(() => second.run(() => useAyme({ pageFactory }))).toThrow(
    "The Ayme runtime already has an active owner."
  );
});

it("C3: accepts a new owner after the first is disposed", () => {
  const first = effectScope();
  scopes.push(first);
  first.run(() => useAyme({ pageFactory }));
  first.stop();
  const second = effectScope();
  scopes.push(second);
  expect(() => second.run(() => useAyme({ pageFactory }))).not.toThrow();
});

it("C7: usePageObject without an owner names the owner to add", () => {
  const scope = effectScope();
  scopes.push(scope);
  expect(() => scope.run(() => usePageObject(Model))).toThrow(
    "requires useAyme() or an AymeProvider"
  );
});

it("C8: rejects a Page Object Model the compiler did not reach", () => {
  class Uncompiled {
    constructor(readonly page: Page) {}
  }
  const scope = effectScope();
  scopes.push(scope);
  expect(() =>
    scope.run(() => {
      useAyme({ pageFactory });
      usePageObject(Uncompiled);
    })
  ).toThrow("The imported page object has no compiler-derived Ayme metadata.");
});

it("C5: follows the session's status, and a retry is the session's own", async () => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  const scope = effectScope();
  scopes.push(scope);
  const { ayme, webMCP } = scope.run(() =>
    useAyme({ pageFactory, webMCP: { enabled: true } })
  )!;
  expect(webMCP.retryPublication).toBe(ayme.webMCP.retryPublication);
  await webMCP.retryPublication();
  expect(webMCP.publicationStatus).toEqual(ayme.webMCP.publicationStatus);
  expect(webMCP.publicationStatus.state).toBe("active");
});

it("C2: stops the session when the provider is unmounted", () => {
  let ayme: ReturnType<typeof useAyme>["ayme"] | undefined;
  const Child = defineComponent({
    setup() {
      ({ ayme } = useAyme());
      return () => null;
    },
  });
  const app = mount({
    render: () => h(AymeProvider, { pageFactory }, { default: () => h(Child) }),
  });
  expect(ayme?.webMCP.publicationStatus.state).toBe("disabled");
  app.unmount();
  expect(ayme?.webMCP.publicationStatus.state).toBe("disposed");
});

it("C6: keeps a model registered until its last consumer is disposed", async () => {
  const first = ref(true);
  const second = ref(true);
  const Consumer = defineComponent({
    setup() {
      usePageObject(Model);
      return () => null;
    },
  });
  mount({
    render: () =>
      h(
        AymeProvider,
        { pageFactory },
        {
          default: () => [
            first.value ? h(Consumer, { key: 1 }) : null,
            second.value ? h(Consumer, { key: 2 }) : null,
          ],
        }
      ),
  });
  expect(listRegisteredPoms()).toHaveLength(1);
  first.value = false;
  await nextTick();
  expect(listRegisteredPoms()).toHaveLength(1);
  second.value = false;
  await nextTick();
  expect(listRegisteredPoms()).toHaveLength(0);
});

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

it("C5: keeps a real publisher startup failure retryable", async () => {
  vi.stubGlobal("MutationObserver", FakeMutationObserver);

  let resolveInitialRegistration = () => {};
  let failRegistration = true;
  const registerTool = vi.fn(() => {
    if (registerTool.mock.calls.length === 1)
      return new Promise<void>((resolve) => {
        resolveInitialRegistration = resolve;
      });
    if (failRegistration) throw new Error("synchronous registration failed");
  });
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool },
  });

  class IntegrationPage {
    run() {}
  }
  registerCompiledPom(IntegrationPage, {
    className: "IntegrationPage",
    components: [],
    members: [],
    tools: [
      {
        methodName: "run",
        toolName: "run",
        description: "Run",
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

  const scope = effectScope();
  scopes.push(scope);
  const result = scope.run(() =>
    useAyme({ pageFactory, webMCP: { enabled: true } })
  );
  await flushPromises();

  resolveInitialRegistration();
  queueMicrotask(() => result?.ayme.pom.register(IntegrationPage));
  await flushPromises();

  expect(result?.webMCP.publicationStatus).toEqual({
    state: "failed",
    message: "WebMCP publication failed: synchronous registration failed",
  });

  failRegistration = false;
  await result?.webMCP.retryPublication();
  expect(result?.webMCP.publicationStatus.state).toBe("active");
});

// usePeek seam: the composable's contract with `ayme.peek`, which it adapts
// (ADR-0031). The Peek Tool an agent reads is covered by the runtime's
// browser tests and the examples' Agent Connection suite; here the dev gate
// stays off, so no Agent Connection loads or scans.
describe("usePeek", () => {
  type PeekCall = { read: () => unknown; name: string; id?: string };
  let calls: PeekCall[];
  let removed: PeekCall[];
  beforeEach(async () => {
    calls = [];
    removed = [];
    const { createAyme: actual } =
      await vi.importActual<typeof import("@ayme-dev/ayme")>("@ayme-dev/ayme");
    vi.mocked(createAyme).mockImplementation((options) => {
      const ayme = actual(options);
      vi.spyOn(ayme, "peek").mockImplementation((read, name, id) => {
        const call = { read, name, id };
        calls.push(call);
        return () => void removed.push(call);
      });
      return ayme;
    });
  });
  afterEach(async () => {
    const { createAyme: actual } =
      await vi.importActual<typeof import("@ayme-dev/ayme")>("@ayme-dev/ayme");
    vi.mocked(createAyme).mockImplementation(actual);
  });

  const Counter = defineComponent({
    props: { start: { type: Number, default: 0 }, id: String },
    setup(props) {
      const count = ref(props.start);
      usePeek({ count }, "counter", props.id);
      return () =>
        h("button", { onClick: () => (count.value += 1) }, count.value);
    },
  });
  const provided = (content: () => unknown) =>
    defineComponent({
      setup: () => () => h(AymeProvider, { pageFactory }, { default: content }),
    });

  it("C12: adds one instance per mounted component, under its own id", () => {
    mount(provided(() => [h(Counter), h(Counter, { start: 5 })]));

    expect(calls.map(({ name }) => name)).toEqual(["counter", "counter"]);
    expect(calls[0]!.id).toEqual(expect.any(String));
    expect(calls[1]!.id).toEqual(expect.any(String));
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(calls.map(({ read }) => read())).toEqual([
      { count: 0 },
      { count: 5 },
    ]);
  });

  it("uses the id it is given", () => {
    mount(provided(() => h(Counter, { id: "cart-7" })));

    expect(calls.map(({ id }) => id)).toEqual(["cart-7"]);
  });

  it("reads refs' current values without adding the instance again", async () => {
    const host = document.createElement("div");
    const app = createApp(provided(() => h(Counter)));
    apps.push(app);
    app.mount(host);

    host.querySelector("button")!.click();
    await nextTick();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.read()).toEqual({ count: 1 });
  });

  it("reads a ref or a reactive object given as the values", () => {
    const total = ref(3);
    const cart = reactive({ items: ["tea"] });
    const Peeks = defineComponent({
      setup() {
        usePeek(total, "total");
        usePeek(cart, "cart");
        return () => null;
      },
    });
    mount(provided(() => h(Peeks)));

    total.value = 4;
    cart.items.push("milk");

    expect(calls.map(({ read }) => read())).toEqual([
      4,
      { items: ["tea", "milk"] },
    ]);
  });

  it("C12: removes the instance on unmount", async () => {
    const visible = ref(true);
    mount(provided(() => (visible.value ? h(Counter) : null)));

    visible.value = false;
    await nextTick();

    expect(calls).toHaveLength(1);
    expect(removed).toEqual(calls);
  });

  it("adds the instance only once mounted", () => {
    let callsInSetup: number | undefined;
    const Probe = defineComponent({
      setup() {
        usePeek({}, "probe");
        callsInSetup = calls.length;
        return () => null;
      },
    });
    mount(provided(() => h(Probe)));

    expect(callsInSetup).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("requires an owner above", () => {
    const errors: unknown[] = [];
    const app = createApp(Counter);
    app.config.errorHandler = (error) => errors.push(error);
    apps.push(app);
    app.mount(document.createElement("div"));

    expect(errors.map(String)).toEqual([
      expect.stringContaining("usePeek requires useAyme()"),
    ]);
  });
});
