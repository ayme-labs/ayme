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
import { createRuntimeSession } from "@ayme-dev/webmcp";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/webmcp/internal";

vi.mock("@ayme-dev/webmcp", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/webmcp")>();
  return {
    ...original,
    createRuntimeSession: vi.fn(original.createRuntimeSession),
  };
});
import {
  AymeWebMcpProvider,
  useAymeWebMcp,
  usePageObject,
  type UseAymeWebMcpOptions,
} from "./index";

type PageFactory = NonNullable<UseAymeWebMcpOptions["page"]>;
type Page = ReturnType<PageFactory>;
const page = {} as Page;
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
  vi.mocked(createRuntimeSession).mockClear();
  vi.unstubAllGlobals();
});

it("passes the page factory and ignore to the runtime session", () => {
  const ignore = (element: Element) => element.matches(".assistant");
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAymeWebMcp({ page: pageFactory, ignore }));
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore,
    refTools: undefined,
    goalLoop: undefined,
  });
});

it("passes refTools to the runtime session", () => {
  const refTools = [
    {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async () => null,
    },
  ];
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAymeWebMcp({ page: pageFactory, refTools }));
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore: undefined,
    refTools,
    goalLoop: undefined,
  });
});

it("passes goalLoop to the runtime session", () => {
  const goalLoop = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useAymeWebMcp({ page: pageFactory, goalLoop }));
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore: undefined,
    refTools: undefined,
    goalLoop,
  });
});

it("calls the page factory once for the owner's runtime, on start", () => {
  const factory = vi.fn(pageFactory);
  const scope = effectScope();
  scopes.push(scope);
  const instance = scope.run(() => {
    useAymeWebMcp({ page: factory });
    expect(factory).toHaveBeenCalledOnce();
    return usePageObject(Model);
  })!;
  expect(instance.page).toBe(page);
  expect(factory).toHaveBeenCalledOnce();
});

it("preserves standalone effectScope setup, direct instance return and disposal", () => {
  const scope = effectScope();
  scopes.push(scope);
  const result = scope.run(() => {
    const runtime = useAymeWebMcp({ page: pageFactory });
    const instance = usePageObject(Model);
    expectTypeOf(instance).toEqualTypeOf<Model>();
    return { runtime, instance };
  })!;
  expect(result.instance.page).toBe(page);
  expect(result.runtime.publicationStatus.value.state).toBe("disabled");
  expect(listRegisteredPoms()).toHaveLength(1);
  scope.stop();
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(result.runtime.publicationStatus.value.state).toBe("disposed");
});

it("requires a Vue scope and a single-argument constructor", () => {
  expect(() => useAymeWebMcp()).toThrow("active Vue effect scope");
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
    let state: ReturnType<typeof useAymeWebMcp> | undefined;
    const Child = defineComponent({
      setup() {
        state = useAymeWebMcp();
        instance = usePageObject(Model);
        return () => null;
      },
    });
    const Root = defineComponent({
      setup() {
        if (kind === "standalone") useAymeWebMcp({ page: pageFactory });
        const content = () => (visible.value ? h(Child) : null);
        return kind === "provider"
          ? () =>
              h(AymeWebMcpProvider, { page: pageFactory }, { default: content })
          : content;
      },
    });
    const app = mount(Root);
    expect(instance?.page).toBe(page);
    expect(state?.publicationStatus.value.state).toBe("disabled");
    expect(listRegisteredPoms()).toHaveLength(1);
    visible.value = false;
    await nextTick();
    expect(listRegisteredPoms()).toHaveLength(0);
    const scope = effectScope();
    scopes.push(scope);
    expect(() => scope.run(() => useAymeWebMcp({ page: pageFactory }))).toThrow(
      "active owner"
    );
    visible.value = true;
    const previous = instance;
    await nextTick();
    expect(instance).not.toBe(previous);
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
        useAymeWebMcp({ page: pageFactory });
      } catch (error) {
        errors.push(error);
      }
      try {
        useAymeWebMcp({ ignore });
      } catch (error) {
        errors.push(error);
      }
      return () => h(AymeWebMcpProvider, { page: pageFactory });
    },
  });
  const app = createApp({
    render: () =>
      h(AymeWebMcpProvider, { page: pageFactory }, { default: () => h(Child) }),
  });
  app.config.errorHandler = (error) => errors.push(error);
  apps.push(app);
  app.mount(document.createElement("div"));
  expect(errors.map(String)).toEqual([
    expect.stringContaining(
      "Configure page, ignore, refTools and goalLoop on the ancestor"
    ),
    expect.stringContaining(
      "Configure page, ignore, refTools and goalLoop on the ancestor"
    ),
    expect.stringContaining("cannot be nested"),
  ]);
});

it("creates the default page and reports real publication state to consumers", async () => {
  vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", true);
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  let state: ReturnType<typeof useAymeWebMcp> | undefined;
  let instance: Model | undefined;
  const Child = defineComponent({
    setup() {
      state = useAymeWebMcp();
      instance = usePageObject(Model);
      return () => null;
    },
  });
  const app = mount({
    render: () => h(AymeWebMcpProvider, null, { default: () => h(Child) }),
  });
  expect(typeof instance?.page.getByRole).toBe("function");
  await state?.retryPublication();
  expect(state?.publicationStatus.value.state).toBe("active");
  app.unmount();
  Reflect.deleteProperty(document, "modelContext");
});
