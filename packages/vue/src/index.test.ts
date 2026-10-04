// @vitest-environment jsdom
import {
  createApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
  ref,
  type App,
  type Component,
} from "vue";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
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
  vi.mocked(createAyme).mockClear();
  vi.unstubAllGlobals();
});

it("passes the page factory and ignore to the runtime session", () => {
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

it("passes customTools to the runtime session", () => {
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

it("passes goalLoop to the runtime session", () => {
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

it("passes webMCP to the runtime session", () => {
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

// Records the options, then starts a session without the Inspector: the
// optional peer may not be built or installed where these tests run.
async function withoutInspectorLoad() {
  const { createAyme: actual } =
    await vi.importActual<typeof import("@ayme-dev/ayme")>("@ayme-dev/ayme");
  vi.mocked(createAyme).mockImplementationOnce((options) =>
    actual({ ...options, inspector: false })
  );
}

it("passes inspector to the runtime session", async () => {
  await withoutInspectorLoad();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAyme({ pageFactory, inspector: true }));
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ inspector: true })
  );
});

it("passes navigate from the provider to the runtime session", () => {
  const navigate = vi.fn();
  mount({ render: () => h(AymeProvider, { pageFactory, navigate }) });
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ navigate })
  );
});

it("returns the session as ayme, so a goal runs through it, and its webMCP member", async () => {
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

it("calls the page factory once for the owner's runtime, on start", () => {
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

it("preserves standalone effectScope setup, direct instance return and disposal", () => {
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

it("requires a Vue scope and a single-argument constructor", () => {
  expect(() => useAyme()).toThrow("active Vue effect scope");
  expect(() => usePageObject(Model)).toThrow("active Vue effect scope");
  expectTypeOf(ComplexModel).not.toMatchTypeOf<
    Parameters<typeof usePageObject>[0]
  >();
});

it.each(["provider", "standalone"])(
  "shares the %s owner's page with descendants without transferring ownership",
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

it("rejects child page and ignore options and nested providers", () => {
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

it("creates the default page and reports real publication state to consumers", async () => {
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
  Reflect.deleteProperty(document, "modelContext");
});

it("rejects changing a mounted provider's options", async () => {
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
