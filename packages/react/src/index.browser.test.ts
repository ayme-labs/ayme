import * as React from "react";
import { createElement as h, StrictMode, Suspense, useEffect } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import * as TestUtils from "react-dom/test-utils";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
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

it("C1: passes the page factory and ignore to the runtime session", async () => {
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

it("C1: passes customTools to the runtime session", async () => {
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

it("C1: passes goalLoop to the runtime session", async () => {
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

it("C1, C4: passes webMCP to the runtime session and accepts an equal object on rerender", async () => {
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

// The HTML below is what the server renders for these trees (see ssr.test.ts).
it("C10: hydrates the server's initial status without warnings and then registers the Page Object", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Child() {
    usePageObject(Model);
    const { webMCP } = useAyme();
    return h("span", null, webMCP.publicationStatus.state);
  }
  const container = document.createElement("div");
  container.innerHTML = "<span>disabled</span>";
  const span = container.querySelector("span");
  let app: Root | undefined;
  await act(() => {
    app = hydrateRoot(container, h(AymeProvider, { pageFactory }, h(Child)));
  });
  roots.push(app!);
  expect(container.querySelector("span")).toBe(span);
  expect(span?.textContent).toBe("disabled");
  expect(listRegisteredPoms()).toHaveLength(1);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("C10: hydrates the server's waiting status without warnings when publication is enabled", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Child() {
    const { webMCP } = useAyme();
    return h("span", null, webMCP.publicationStatus.state);
  }
  const container = document.createElement("div");
  container.innerHTML = "<span>waiting</span>";
  let app: Root | undefined;
  await act(() => {
    app = hydrateRoot(
      container,
      h(AymeProvider, { pageFactory, webMCP: { enabled: true } }, h(Child))
    );
  });
  roots.push(app!);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("C10: renders the same Page Object identity in hydration as on the server", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Child() {
    const same = usePageObject(Model) === useAyme().ayme.pom.get(Model);
    return h("output", null, String(same));
  }
  const container = document.createElement("div");
  container.innerHTML = "<output>true</output>";
  let app: Root | undefined;
  await act(() => {
    app = hydrateRoot(container, h(AymeProvider, { pageFactory }, h(Child)));
  });
  roots.push(app!);
  expect(container.textContent).toBe("true");
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("C2, C6: keeps one custom-page instance through StrictMode replay, rerenders and remounts", async () => {
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

it("C6: does not register or claim ownership for an abandoned suspended render", async () => {
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

it("C5: renders live publication state and retries without replacing the Page Object", async () => {
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

it("C11: returns the session as ayme, so a goal runs through it, and its webMCP member", async () => {
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

it("C1, C4: passes inspector to the runtime session and rejects changing it", async () => {
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

it("C1, C4: passes agentConnection to the runtime session and rejects changing it", async () => {
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

it("C7: requires an ancestor provider", async () => {
  function Child() {
    useAyme();
    return null;
  }
  await expect(act(async () => root().render(h(Child)))).rejects.toThrow(
    "ancestor AymeProvider"
  );
});

it("C3: rejects nested owners", async () => {
  await expect(
    act(async () =>
      root().render(
        h(AymeProvider, { pageFactory }, h(AymeProvider, { pageFactory }))
      )
    )
  ).rejects.toThrow("cannot be nested");
});

it("C4: rejects changing a mounted provider's page factory", async () => {
  const app = root();
  await act(() => app.render(h(AymeProvider, { pageFactory })));
  await expect(
    act(async () =>
      app.render(h(AymeProvider, { pageFactory: () => ({}) as Page }))
    )
  ).rejects.toThrow("provider options must stay fixed");
});

it("C6: requires remounting to change the model class", async () => {
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

it("C4: changes the options when the provider is remounted", async () => {
  const app = root();
  const render = (key: string, prefix: string) =>
    h(AymeProvider, {
      key,
      pageFactory,
      webMCP: { enabled: false, toolNamePrefix: prefix },
    });
  await act(() => app.render(render("first", "ayme_")));
  await act(() => app.render(render("second", "other_")));
  expect(createAyme).toHaveBeenCalledTimes(2);
  expect(createAyme).toHaveBeenLastCalledWith(
    expect.objectContaining({
      webMCP: { enabled: false, toolNamePrefix: "other_" },
    })
  );
});

it("C2: starts the session and stops it when the provider is unmounted", async () => {
  const factory = vi.fn(pageFactory);
  let ayme: ReturnType<typeof useAyme>["ayme"] | undefined;
  function Child() {
    ({ ayme } = useAyme());
    return null;
  }
  const app = root();
  await act(() =>
    app.render(h(AymeProvider, { pageFactory: factory }, h(Child)))
  );
  expect(factory).toHaveBeenCalledOnce();
  expect(ayme?.webMCP.publicationStatus.state).toBe("disabled");
  await act(() => app.unmount());
  roots.splice(roots.indexOf(app), 1);
  expect(ayme?.webMCP.publicationStatus.state).toBe("disposed");
});

it("C3: rejects a second owner while the first is active, and accepts a new one after it is disposed", async () => {
  const first = root();
  await act(() => first.render(h(AymeProvider, { pageFactory })));
  await expect(
    act(async () => root().render(h(AymeProvider, { pageFactory })))
  ).rejects.toThrow("The Ayme runtime already has an active owner.");
  await act(() => first.unmount());
  roots.splice(roots.indexOf(first), 1);
  await act(() => root().render(h(AymeProvider, { pageFactory })));
});

it("C6: keeps a model registered until its last consumer is disposed", async () => {
  function Consumer() {
    usePageObject(Model);
    return null;
  }
  const render = (first: boolean, second: boolean) =>
    h(
      AymeProvider,
      { pageFactory },
      first ? h(Consumer, { key: 1 }) : null,
      second ? h(Consumer, { key: 2 }) : null
    );
  const app = root();
  await act(() => app.render(render(true, true)));
  expect(listRegisteredPoms()).toHaveLength(1);
  await act(() => app.render(render(false, true)));
  expect(listRegisteredPoms()).toHaveLength(1);
  await act(() => app.render(render(false, false)));
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("C7: usePageObject without a provider names the provider to add", async () => {
  function Child() {
    usePageObject(Model);
    return null;
  }
  await expect(act(async () => root().render(h(Child)))).rejects.toThrow(
    "ancestor AymeProvider"
  );
});

it("C8: rejects a Page Object Model the compiler did not reach", async () => {
  class Uncompiled {
    constructor(readonly page: Page) {}
  }
  function Child() {
    usePageObject(Uncompiled);
    return null;
  }
  await expect(
    act(async () => root().render(h(AymeProvider, { pageFactory }, h(Child))))
  ).rejects.toThrow(
    "The imported page object has no compiler-derived Ayme metadata."
  );
});
