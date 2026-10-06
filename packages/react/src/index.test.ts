import * as React from "react";
import { createElement as h, StrictMode, Suspense, useEffect } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import * as TestUtils from "react-dom/test-utils";
import { renderToString } from "react-dom/server";
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
  type AymeProviderProps,
} from "./index";

// React exports act from 18.3; the 18.0 compatibility lane falls back to
// react-dom/test-utils, which React 19 deprecates.
const act: typeof TestUtils.act =
  (React as { act?: typeof TestUtils.act }).act ?? TestUtils.act;

type PageFactory = NonNullable<AymeProviderProps["pageFactory"]>;
type Page = ReturnType<PageFactory>;
const page = { url: () => "factory page" } as unknown as Page;
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
  vi.mocked(createAyme).mockClear();
  vi.unstubAllGlobals();
});

it("passes the page factory and ignore to the runtime session", async () => {
  const ignore = (element: Element) => element.matches(".assistant");
  await act(() =>
    root().render(
      h(
        AymeProvider,
        { pageFactory, ignore },
        h(() => null)
      )
    )
  );
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore,
    customTools: undefined,
    goalLoop: undefined,
  });
});

it("passes customTools to the runtime session", async () => {
  const customTools = [
    {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async () => null,
    },
  ];
  await act(() =>
    root().render(
      h(
        AymeProvider,
        { pageFactory, customTools },
        h(() => null)
      )
    )
  );
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools,
    goalLoop: undefined,
  });
});

it("passes goalLoop to the runtime session", async () => {
  const goalLoop = vi.fn();
  await act(() =>
    root().render(
      h(
        AymeProvider,
        { pageFactory, goalLoop },
        h(() => null)
      )
    )
  );
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools: undefined,
    goalLoop,
  });
});

it("passes webMCP to the runtime session and accepts an equal object on rerender", async () => {
  const app = root();
  await act(() =>
    app.render(
      h(
        AymeProvider,
        { pageFactory, webMCP: { enabled: false, toolNamePrefix: "ayme_" } },
        h(() => null)
      )
    )
  );
  expect(createAyme).toHaveBeenCalledWith({
    pageFactory,
    ignore: undefined,
    customTools: undefined,
    goalLoop: undefined,
    webMCP: { enabled: false, toolNamePrefix: "ayme_" },
  });
  await act(() =>
    app.render(
      h(
        AymeProvider,
        { pageFactory, webMCP: { enabled: false, toolNamePrefix: "ayme_" } },
        h(() => null)
      )
    )
  );
  expect(createAyme).toHaveBeenCalledOnce();
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
    const { webMCP } = useAyme();
    return h(
      "button",
      { onClick: () => model.increment() },
      webMCP.publicationStatus.state
    );
  }

  expect(
    renderToString(h(AymeProvider, { pageFactory: factory }, h(Child)))
  ).toContain(">disabled</button>");
  expect(constructions).toBe(0);
  expect(factory).not.toHaveBeenCalled();
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("hydrates server output without warnings and then registers the Page Object", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Child() {
    usePageObject(Model);
    return h("span", null, "ready");
  }
  const tree = () => h(AymeProvider, { pageFactory }, h(Child));
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree());
  const span = container.querySelector("span");
  let app: Root | undefined;
  await act(() => {
    app = hydrateRoot(container, tree());
  });
  roots.push(app!);
  expect(container.querySelector("span")).toBe(span);
  expect(listRegisteredPoms()).toHaveLength(1);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("renders the same Page Object identity on the server as in hydration", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Child() {
    const same = usePageObject(Model) === useAyme().ayme.pom.get(Model);
    return h("output", null, String(same));
  }
  const tree = () => h(AymeProvider, { pageFactory }, h(Child));
  const container = document.createElement("div");
  vi.stubGlobal("window", undefined);
  try {
    container.innerHTML = renderToString(tree());
  } finally {
    vi.unstubAllGlobals();
  }
  expect(container.textContent).toBe("true");
  let app: Root | undefined;
  await act(() => {
    app = hydrateRoot(container, tree());
  });
  roots.push(app!);
  expect(container.textContent).toBe("true");
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("keeps one custom-page instance through StrictMode replay, rerenders and remounts", async () => {
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
      h(AymeProvider, { pageFactory: factory }, h(Child, { key }))
    );
  await act(() => app.render(render("first")));
  expect(current?.page.url()).toBe(page.url());
  expect(factory).toHaveBeenCalledOnce();
  expect(committed.length).toBeGreaterThanOrEqual(2);
  expect(new Set(committed).size).toBe(1);
  expect(listRegisteredPoms()).toHaveLength(1);
  expect(listRegisteredPoms()[0]?.instance).toBe(current);
  const first = current;
  await act(() => app.render(render("first")));
  expect(current).toBe(first);
  await act(() => app.render(render("second")));
  // The session keeps one instance per class.
  expect(current).toBe(first);
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
        h(AymeProvider, { pageFactory }, h(Suspended))
      )
    )
  );
  expect(listRegisteredPoms()).toHaveLength(0);
  function Ready() {
    usePageObject(Model);
    return null;
  }
  await act(() => app.render(h(AymeProvider, { pageFactory }, h(Ready))));
  expect(listRegisteredPoms()).toHaveLength(1);
});

it("renders live publication state and retries without replacing the Page Object", async () => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  const states: string[] = [];
  let current: Model | undefined;
  let retry: (() => Promise<void>) | undefined;
  function Child() {
    current = usePageObject(Model);
    const { webMCP } = useAyme();
    states.push(webMCP.publicationStatus.state);
    retry = webMCP.retryPublication;
    return null;
  }
  await act(() =>
    root().render(h(AymeProvider, { webMCP: { enabled: true } }, h(Child)))
  );
  expect(typeof current?.page.getByRole).toBe("function");
  expect(states).toContain("waiting");
  expect(states.at(-1)).toBe("active");
  const previous = current;
  await act(async () => {
    await retry?.();
  });
  expect(current).toBe(previous);
});

it("returns the session as ayme, so a goal runs through it, and its webMCP member", async () => {
  const goalLoop = vi.fn(async () => {
    throw new Error("No decision.");
  });
  let result: ReturnType<typeof useAyme> | undefined;
  function Child() {
    result = useAyme();
    return null;
  }
  await act(() =>
    root().render(h(AymeProvider, { pageFactory, goalLoop }, h(Child)))
  );
  const ayme = result!.ayme;
  expect(ayme).toBe(vi.mocked(createAyme).mock.results[0]?.value);
  expect(result!.webMCP.publicationStatus).toBe(ayme.webMCP.publicationStatus);
  expect(result!.webMCP.retryPublication).toBe(ayme.webMCP.retryPublication);
  const handover = await ayme.tools.run("goal", {
    goal: "Save the form",
    maxSteps: 1,
  });
  expect(goalLoop).toHaveBeenCalledOnce();
  expect(handover.reason).toBe("decide_failed");
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

it("passes inspector to the runtime session and rejects changing it", async () => {
  await withoutInspectorLoad();
  const app = root();
  await act(() =>
    app.render(h(AymeProvider, { pageFactory, inspector: true }))
  );
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ inspector: true })
  );
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory, inspector: false }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("passes agentConnection to the runtime session and rejects changing it", async () => {
  await withoutInspectorLoad();
  const app = root();
  await act(() =>
    app.render(h(AymeProvider, { pageFactory, agentConnection: true }))
  );
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ agentConnection: true })
  );
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory, agentConnection: false }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("C1, C4: passes navigate to the runtime session and rejects changing it", async () => {
  const navigate = vi.fn();
  const app = root();
  await act(() => app.render(h(AymeProvider, { pageFactory, navigate })));
  expect(createAyme).toHaveBeenCalledWith(
    expect.objectContaining({ navigate })
  );
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory, navigate: vi.fn() }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("C1, C4: passes an inline inspector demo setting and keeps it fixed across renders", async () => {
  await withoutInspectorLoad();
  const app = root();
  await act(() =>
    app.render(h(AymeProvider, { pageFactory, inspector: { demo: true } }))
  );
  await act(() =>
    app.render(h(AymeProvider, { pageFactory, inspector: { demo: true } }))
  );
  expect(createAyme).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ inspector: { demo: true } })
  );
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory, inspector: true }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("requires an ancestor provider", async () => {
  function Child() {
    useAyme();
    return null;
  }
  await expect(act(async () => root().render(h(Child)))).rejects.toThrow(
    "ancestor AymeProvider"
  );
});

it("rejects nested owners", async () => {
  await expect(
    act(async () =>
      root().render(
        h(AymeProvider, { pageFactory }, h(AymeProvider, { pageFactory }))
      )
    )
  ).rejects.toThrow("cannot be nested");
});

it("rejects changing a mounted provider's page factory", async () => {
  const app = root();
  await act(() => app.render(h(AymeProvider, { pageFactory })));
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory: () => ({}) as Page }))
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
    app.render(h(AymeProvider, { pageFactory }, h(Child, { model: Model })))
  );
  await expect(
    act(async () =>
      app.render(
        h(AymeProvider, { pageFactory }, h(Child, { model: OtherModel }))
      )
    )
  ).rejects.toThrow("model and provider must stay fixed");
});

// usePeek seam: the hook's contract with `ayme.peek`, which it adapts
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

  function Counter({ count, id }: { count: number; id?: string }) {
    usePeek({ count }, "counter", id);
    return null;
  }

  it("C12: adds one instance per mounted component, under its own id", async () => {
    await act(() =>
      root().render(
        h(
          AymeProvider,
          { pageFactory },
          h(Counter, { count: 0 }),
          h(Counter, { count: 5 })
        )
      )
    );

    expect(calls.map(({ name }) => name)).toEqual(["counter", "counter"]);
    expect(calls[0]!.id).toEqual(expect.any(String));
    expect(calls[1]!.id).toEqual(expect.any(String));
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(calls.map(({ read }) => read())).toEqual([
      { count: 0 },
      { count: 5 },
    ]);
  });

  it("uses the id it is given", async () => {
    await act(() =>
      root().render(
        h(AymeProvider, { pageFactory }, h(Counter, { count: 0, id: "cart-7" }))
      )
    );

    expect(calls.map(({ id }) => id)).toEqual(["cart-7"]);
  });

  it("reads the latest render's values without adding the instance again", async () => {
    const app = root();
    const tree = (count: number) =>
      h(AymeProvider, { pageFactory }, h(Counter, { count }));
    await act(() => app.render(tree(0)));

    await act(() => app.render(tree(1)));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.read()).toEqual({ count: 1 });
  });

  it("C12: removes the instance on unmount", async () => {
    const app = root();
    await act(() =>
      app.render(h(AymeProvider, { pageFactory }, h(Counter, { count: 0 })))
    );

    await act(() => app.render(h(AymeProvider, { pageFactory })));

    expect(removed).toEqual(calls);
  });

  it("keeps one live instance through StrictMode's remount", async () => {
    await act(() =>
      root().render(
        h(
          StrictMode,
          null,
          h(AymeProvider, { pageFactory }, h(Counter, { count: 3 }))
        )
      )
    );

    const live = calls.filter((call) => !removed.includes(call));
    expect(live).toHaveLength(1);
    expect(new Set(calls.map(({ id }) => id))).toEqual(new Set([live[0]!.id]));
    expect(live[0]!.read()).toEqual({ count: 3 });
  });

  it("C12: adds nothing during server rendering", () => {
    renderToString(h(AymeProvider, { pageFactory }, h(Counter, { count: 0 })));

    expect(createAyme).toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("requires an ancestor provider", async () => {
    await expect(
      act(async () => root().render(h(Counter, { count: 0 })))
    ).rejects.toThrow("ancestor AymeProvider");
  });
});
