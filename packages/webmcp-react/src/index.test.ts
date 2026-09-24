import {
  act,
  createElement as h,
  StrictMode,
  Suspense,
  useEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
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
  type AymeWebMcpProviderProps,
} from "./index";

type PageFactory = NonNullable<AymeWebMcpProviderProps["page"]>;
type Page = ReturnType<PageFactory>;
const page = {} as Page;
const pageFactory: PageFactory = () => page;
class Model {
  constructor(readonly page: Page) {}
}
class OtherModel extends Model {}
for (const model of [Model, OtherModel])
  registerCompiledPom(model, {
    className: model.name,
    components: [],
    members: [],
    tools: [],
  });
const roots: Root[] = [];
function root() {
  const result = createRoot(document.createElement("div"));
  roots.push(result);
  return result;
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  Reflect.deleteProperty(document, "modelContext");
  vi.mocked(createRuntimeSession).mockClear();
  vi.unstubAllGlobals();
});

it("passes the page factory and ignore to the runtime session", async () => {
  const ignore = (element: Element) => element.matches(".assistant");
  await act(() =>
    root().render(
      h(
        AymeWebMcpProvider,
        { page: pageFactory, ignore },
        h(() => null)
      )
    )
  );
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore,
    refTools: undefined,
    goalLoop: undefined,
  });
});

it("passes refTools to the runtime session", async () => {
  const refTools = [
    {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async () => null,
    },
  ];
  await act(() =>
    root().render(
      h(
        AymeWebMcpProvider,
        { page: pageFactory, refTools },
        h(() => null)
      )
    )
  );
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore: undefined,
    refTools,
    goalLoop: undefined,
  });
});

it("passes goalLoop to the runtime session", async () => {
  const goalLoop = vi.fn();
  await act(() =>
    root().render(
      h(
        AymeWebMcpProvider,
        { page: pageFactory, goalLoop },
        h(() => null)
      )
    )
  );
  expect(createRuntimeSession).toHaveBeenCalledWith({
    page: pageFactory,
    ignore: undefined,
    refTools: undefined,
    goalLoop,
  });
});

it("server-renders without constructing or registering a Page Object or calling the page factory", () => {
  vi.stubGlobal("window", undefined);
  const factory = vi.fn<PageFactory>(() => {
    throw new Error("The page factory must not run on the server.");
  });
  let constructions = 0;
  class ServerModel {
    constructor(readonly page: Page) {
      constructions += 1;
    }
    increment() {}
  }
  registerCompiledPom(ServerModel, {
    className: "ServerModel",
    components: [],
    members: [],
    tools: [],
  });
  function Child() {
    const model = usePageObject(ServerModel);
    const { publicationStatus } = useAymeWebMcp();
    return h(
      "button",
      { onClick: () => model.increment() },
      publicationStatus.state
    );
  }

  expect(
    renderToString(h(AymeWebMcpProvider, { page: factory }, h(Child)))
  ).toContain(">disabled</button>");
  expect(constructions).toBe(0);
  expect(factory).not.toHaveBeenCalled();
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("retains a custom-page instance through StrictMode replay and rerenders, then replaces it on remount", async () => {
  const factory = vi.fn(pageFactory);
  const committed: Model[] = [];
  let current: Model | undefined;
  function Child() {
    current = usePageObject(Model);
    expectTypeOf(current).toEqualTypeOf<Model>();
    const instance = current;
    useEffect(() => {
      committed.push(instance);
    }, [instance]);
    return null;
  }
  const app = root();
  const render = (key: string) =>
    h(
      StrictMode,
      null,
      h(AymeWebMcpProvider, { page: factory }, h(Child, { key }))
    );
  await act(() => app.render(render("first")));
  expect(current?.page).toBe(page);
  expect(factory).toHaveBeenCalledOnce();
  expect(committed.length).toBeGreaterThanOrEqual(2);
  expect(new Set(committed).size).toBe(1);
  expect(listRegisteredPoms()).toHaveLength(1);
  expect(listRegisteredPoms()[0]?.instance).toBe(current);
  const first = current;
  await act(() => app.render(render("first")));
  expect(current).toBe(first);
  await act(() => app.render(render("second")));
  expect(current).not.toBe(first);
  expect(listRegisteredPoms()).toHaveLength(1);
  expect(factory).toHaveBeenCalledOnce();
  await act(() => app.unmount());
  roots.splice(roots.indexOf(app), 1);
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("does not register or claim ownership for an abandoned suspended render", async () => {
  const never = new Promise<void>(() => {});
  function Suspended(): never {
    usePageObject(Model);
    throw never;
  }
  const app = root();
  await act(() =>
    app.render(
      h(
        Suspense,
        { fallback: null },
        h(AymeWebMcpProvider, { page: pageFactory }, h(Suspended))
      )
    )
  );
  expect(listRegisteredPoms()).toHaveLength(0);
  function Ready() {
    usePageObject(Model);
    return null;
  }
  await act(() =>
    app.render(h(AymeWebMcpProvider, { page: pageFactory }, h(Ready)))
  );
  expect(listRegisteredPoms()).toHaveLength(1);
});

it("renders live publication state and retries without replacing the Page Object", async () => {
  vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", true);
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  const states: string[] = [];
  let current: Model | undefined;
  let retry: (() => Promise<void>) | undefined;
  function Child() {
    current = usePageObject(Model);
    const runtime = useAymeWebMcp();
    states.push(runtime.publicationStatus.state);
    retry = runtime.retryPublication;
    return null;
  }
  await act(() => root().render(h(AymeWebMcpProvider, null, h(Child))));
  expect(typeof current?.page.getByRole).toBe("function");
  expect(states).toContain("waiting");
  expect(states.at(-1)).toBe("active");
  const previous = current;
  await act(async () => {
    await retry?.();
  });
  expect(current).toBe(previous);
});

it("requires an ancestor provider", async () => {
  function Child() {
    useAymeWebMcp();
    return null;
  }
  await expect(act(async () => root().render(h(Child)))).rejects.toThrow(
    "ancestor AymeWebMcpProvider"
  );
});

it("rejects nested owners", async () => {
  await expect(
    act(async () =>
      root().render(
        h(
          AymeWebMcpProvider,
          { page: pageFactory },
          h(AymeWebMcpProvider, { page: pageFactory })
        )
      )
    )
  ).rejects.toThrow("cannot be nested");
});

it("rejects changing a mounted provider's page factory", async () => {
  const app = root();
  await act(() => app.render(h(AymeWebMcpProvider, { page: pageFactory })));
  await expect(
    act(async () =>
      app.render(h(AymeWebMcpProvider, { page: () => ({}) as Page }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("requires remounting to change the model class", async () => {
  function Child({ model }: { model: typeof Model }) {
    usePageObject(model);
    return null;
  }
  const app = root();
  await act(() =>
    app.render(
      h(AymeWebMcpProvider, { page: pageFactory }, h(Child, { model: Model }))
    )
  );
  await expect(
    act(async () =>
      app.render(
        h(
          AymeWebMcpProvider,
          { page: pageFactory },
          h(Child, { model: OtherModel })
        )
      )
    )
  ).rejects.toThrow("model and provider must stay fixed");
});
