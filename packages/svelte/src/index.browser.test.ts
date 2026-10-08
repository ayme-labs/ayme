// Client tests of the owner and consumer API, in a real browser. Test names
// cite the rows of the behaviour contract in docs/framework-integrations.md.
// C9 and C10 are in index.ssr.test.ts, which renders on the server.
import { tick } from "svelte";
import { VERSION } from "svelte/compiler";
import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAyme, RuntimeStateError } from "@ayme-dev/ayme";
import { registerCompiledPom } from "@ayme-dev/ayme/internal";

// A mount that throws leaves its started owners undestroyed, so the tests
// stop every started session themselves.
const stops = vi.hoisted(() => [] as (() => void)[]);
vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createAyme: vi.fn((options: Parameters<typeof original.createAyme>[0]) => {
      const session = original.createAyme(options);
      const start = session.start;
      session.start = () => {
        const stop = start();
        stops.push(stop);
        return stop;
      };
      return session;
    }),
  };
});
import {
  Consumer,
  Owner,
  OwnerAndPageObject,
  PageObjectPair,
  PageObjectUser,
  PeekUser,
  PeekUsers,
  Status,
} from "./fixtures/components.js";
import {
  peek,
  useAyme,
  usePageObject,
  type UseAymeOptions,
  type UseAymeResult,
} from "./index";

type PageFactory = NonNullable<UseAymeOptions["pageFactory"]>;
type Page = ReturnType<PageFactory>;
const page = { url: () => "factory page" } as unknown as Page;
const pageFactory: PageFactory = () => page;

class Model {
  constructor(readonly page: Page) {}
}
registerCompiledPom(Model, {
  className: "Model",
  components: [],
  members: [],
  tools: [
    {
      methodName: "ping",
      toolName: "Model.ping",
      description: "Ping.",
      inputSchema: { type: "object", properties: {} },
      parameters: [],
    },
  ],
});
// Never passed through the Ayme compiler, so it has no metadata.
class UncompiledModel {
  constructor(readonly page: Page) {}
}

const legacyInternal =
  Number(VERSION.split(".")[0]) < 5
    ? ((await import("svelte/internal" as string)) as {
        set_current_component(component: null): void;
      })
    : undefined;
const mounted: { $destroy(): void }[] = [];
const targets = new WeakMap<object, Element>();
const container = (component: object) => targets.get(component)!;
function mount<Props>(
  Component: new (options: { target: Element; props?: Props }) => {
    $set(props: Partial<Props>): void;
    $destroy(): void;
  },
  props: Props
) {
  const target = document.body.appendChild(document.createElement("div"));
  let component;
  try {
    component = new Component({ target, props });
  } catch (error) {
    target.remove();
    // Svelte 3 and 4 leave the failed component current, so later calls would
    // find its context.
    if (legacyInternal) legacyInternal.set_current_component(null);
    throw error;
  }
  targets.set(component, target);
  mounted.push(component);
  return component;
}
function destroy(component: { $destroy(): void }) {
  mounted.splice(mounted.indexOf(component), 1);
  component.$destroy();
  container(component).remove();
}
afterEach(() => {
  for (const component of mounted.splice(0).reverse()) {
    component.$destroy();
    container(component).remove();
  }
  for (const stop of stops.splice(0)) stop();
  vi.mocked(createAyme).mockClear();
  delete (document as { modelContext?: unknown }).modelContext;
});

/** The names of the tools the session has live, which are none until it starts. */
const liveTools = ({ ayme }: UseAymeResult) =>
  ayme.tools.list().map(({ name }) => name);

it("C1: passes the options to the runtime session unchanged", () => {
  const options: UseAymeOptions = {
    pageFactory,
    ignore: (element) => element.matches(".assistant"),
    customTools: [],
    goalLoop: vi.fn(),
    webMCP: { enabled: false, toolNamePrefix: "ayme_" },
    navigate: vi.fn(),
  };
  let result: UseAymeResult | undefined;
  mount(Owner, { options, onInit: (value) => (result = value) });
  expect(createAyme).toHaveBeenCalledExactlyOnceWith(options);
  expect(result?.ayme).toBe(vi.mocked(createAyme).mock.results[0]?.value);
});

it("C2: starts the runtime before descendants mount and stops it on destroy", () => {
  let result: UseAymeResult | undefined;
  let liveInDescendant: string[] | undefined;
  const owner = mount(Owner, {
    options: { pageFactory },
    onInit: (value) => (result = value),
    child: Consumer,
    childProps: {
      onMounted: (value: UseAymeResult) =>
        (liveInDescendant = liveTools(value)),
    },
  });
  expect(liveInDescendant).toContain("snapshot");
  const { ayme } = result!;
  expect(ayme.webMCP.publicationStatus.state).toBe("disabled");
  destroy(owner);
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
  expect(ayme.tools.list()).toEqual([]);
});

it("C3: gives a descendant without options the owner's value", () => {
  let owner: UseAymeResult | undefined;
  let descendant: UseAymeResult | undefined;
  mount(Owner, {
    onInit: (value) => (owner = value),
    child: Consumer,
    childProps: {
      onInit: (value: UseAymeResult) => (descendant = value),
    },
  });
  expect(descendant).toBe(owner);
  expect(createAyme).toHaveBeenCalledOnce();
});

it("C3: rejects options beneath an owner, naming the owner to configure", () => {
  expect(() =>
    mount(Owner, {
      child: Consumer,
      childProps: { options: {} },
    })
  ).toThrow(
    "Configure Ayme on the ancestor useAyme(options) owner, not beneath it."
  );
});

it("C3: rejects a second owner while the first is active, naming where to call it", () => {
  mount(Owner, { options: { pageFactory } });
  let error: unknown;
  try {
    mount(Owner, { options: { pageFactory } });
  } catch (caught) {
    error = caught;
  }
  // Svelte's development build appends the component stack to the message.
  expect(error).toBeInstanceOf(RuntimeStateError);
  expect((error as Error).message).toMatch(
    /^useAyme\(options\) already has an active owner\. Call it once, in the root \+layout\.svelte or App\.svelte\./
  );
  expect((error as Error).cause).toEqual(
    new RuntimeStateError("The Ayme runtime already has an active owner.", {
      code: "active-owner",
    })
  );
});

it("C3: accepts a new owner after the first is destroyed", () => {
  destroy(mount(Owner, { options: { pageFactory } }));
  let result: UseAymeResult | undefined;
  mount(Owner, {
    options: { pageFactory },
    onInit: (value) => (result = value),
  });
  expect(liveTools(result!)).toContain("snapshot");
});

// C3's nested-owner text is n/a: useAyme is both owner and consumer, and its
// options error above replaces it.

it.skip("C4: n/a, useAyme takes its options once and cannot change them afterwards", () => {});

it("C5: reads the publication status as a store that follows the session", async () => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
  let result: UseAymeResult | undefined;
  const owner = mount(Owner, {
    options: { pageFactory, webMCP: { enabled: true } },
    onInit: (value) => (result = value),
    child: Status,
    shown: false,
  });
  const { ayme, webMCP } = result!;
  expect(webMCP.retryPublication).toBe(ayme.webMCP.retryPublication);
  const unsubscribed = vi.fn();
  const subscribe = ayme.webMCP.subscribe.bind(ayme.webMCP);
  const subscribed = vi
    .spyOn(ayme.webMCP, "subscribe")
    .mockImplementation((listener) => {
      const unsubscribe = subscribe(listener);
      return () => {
        unsubscribed();
        unsubscribe();
      };
    });

  owner.$set({ shown: true });
  await tick();
  expect(subscribed).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(container(owner).textContent).toBe("active"));
  expect(get(webMCP.publicationStatus)).toBe(ayme.webMCP.publicationStatus);

  owner.$set({ shown: false });
  await tick();
  expect(unsubscribed).toHaveBeenCalledOnce();

  // A later subscriber reads the status as it is now.
  destroy(owner);
  expect(get(webMCP.publicationStatus).state).toBe("disposed");
});

it("C6: registers the session's Page Object while its component lives", async () => {
  let result: UseAymeResult | undefined;
  const instances: object[] = [];
  const owner = mount(Owner, {
    options: { pageFactory },
    onInit: (value) => (result = value),
    child: PageObjectUser,
    childProps: {
      model: Model,
      onInit: (instance: object) => instances.push(instance),
    },
  });
  expect(instances).toHaveLength(1);
  expect(instances[0]).toBeInstanceOf(Model);
  expect(instances[0]).toBe(result?.ayme.pom.get(Model));
  expect((instances[0] as Model).page.url()).toBe(page.url());
  expect(liveTools(result!)).toContain("Model.ping");

  owner.$set({ shown: false });
  await tick();
  expect(liveTools(result!)).not.toContain("Model.ping");

  owner.$set({ shown: true });
  await tick();
  expect(instances).toHaveLength(2);
  // The session keeps one instance per class.
  expect(instances[1]).toBe(instances[0]);
  expect(liveTools(result!)).toContain("Model.ping");
});

it("C6: keeps the tools until the last component of the model is destroyed", async () => {
  let result: UseAymeResult | undefined;
  const owner = mount(Owner, {
    options: { pageFactory },
    onInit: (value) => (result = value),
    child: PageObjectPair,
    childProps: { model: Model },
  });
  expect(liveTools(result!)).toContain("Model.ping");
  owner.$set({ childProps: { model: Model, showFirst: false } });
  await tick();
  expect(liveTools(result!)).toContain("Model.ping");
  owner.$set({
    childProps: { model: Model, showFirst: false, showSecond: false },
  });
  await tick();
  expect(liveTools(result!)).not.toContain("Model.ping");
});

it("C6: lets the owner use a Page Object in its own component", () => {
  let result: (UseAymeResult & { pageObject: object }) | undefined;
  const owner = mount(OwnerAndPageObject, {
    options: { pageFactory },
    model: Model,
    onInit: (value) => (result = value),
  });
  expect(result?.pageObject).toBeInstanceOf(Model);
  expect(liveTools(result!)).toContain("Model.ping");
  destroy(owner);
  expect(liveTools(result!)).toEqual([]);
  expect(result?.ayme.webMCP.publicationStatus.state).toBe("disposed");
});

it("C7: requires an owner for a Page Object", () => {
  expect(() => mount(PageObjectUser, { model: Model })).toThrow(
    "usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte."
  );
});

it("C8: throws for a model the compiler did not reach", () => {
  expect(() =>
    mount(Owner, {
      options: { pageFactory },
      child: PageObjectUser,
      childProps: { model: UncompiledModel },
    })
  ).toThrow("The imported page object has no compiler-derived Ayme metadata.");
});

it("C11: runs a goal with the owner's goalLoop through the value every component gets", async () => {
  let owner: UseAymeResult | undefined;
  let descendant: UseAymeResult | undefined;
  const goalLoop = vi.fn(async () => {
    throw new Error("No decision.");
  });
  mount(Owner, {
    options: { pageFactory, goalLoop },
    onInit: (value) => (owner = value),
    child: Consumer,
    childProps: { onInit: (value: UseAymeResult) => (descendant = value) },
  });
  expect(descendant?.ayme).toBe(owner?.ayme);
  await expect(
    descendant!.ayme.tools.run("goal", {
      goal: "Save the changes",
      maxSteps: 1,
    })
  ).resolves.toMatchObject({ reason: "decide_failed" });
  expect(goalLoop).toHaveBeenCalled();
});

it("leaves calls outside component initialisation to Svelte's own error", () => {
  expect(() => useAyme()).toThrow(
    /lifecycle_outside_component|outside component initiali[sz]ation/
  );
  expect(() => usePageObject(Model)).toThrow(
    /lifecycle_outside_component|outside component initiali[sz]ation/
  );
  expect(() => peek(() => 0, "counter")).toThrow(
    /lifecycle_outside_component|outside component initiali[sz]ation/
  );
  expect(createAyme).not.toHaveBeenCalled();
});

// peek seam: the function's contract with `ayme.peek`, which it adapts
// (ADR-0031). The Peek Tool an agent reads is covered by the runtime's
// browser tests and the examples' Agent Connection suite; here the dev gate
// stays off, so no Agent Connection loads or scans.
describe("peek", () => {
  type PeekCall = { read: () => unknown; name: string; id?: string };
  let calls: PeekCall[];
  let removed: PeekCall[];
  const spyOnPeek = ({ ayme }: UseAymeResult) => {
    calls = [];
    removed = [];
    vi.spyOn(ayme, "peek").mockImplementation((read, name, id) => {
      const call = { read, name, id };
      calls.push(call);
      return () => void removed.push(call);
    });
  };

  it("C12: adds one instance per mounted component, under its own id", () => {
    mount(Owner, {
      options: { pageFactory },
      onInit: spyOnPeek,
      child: PeekUsers,
      childProps: { counts: [0, 5] },
    });

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
    mount(Owner, {
      options: { pageFactory },
      onInit: spyOnPeek,
      child: PeekUser,
      childProps: { id: "cart-7" },
    });

    expect(calls.map(({ id }) => id)).toEqual(["cart-7"]);
  });

  it("reads the component's current state without adding the instance again", async () => {
    const owner = mount(Owner, {
      options: { pageFactory },
      onInit: spyOnPeek,
      child: PeekUser,
      childProps: { count: 0 },
    });

    owner.$set({ childProps: { count: 1 } });
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.read()).toEqual({ count: 1 });
  });

  it("C12: removes the instance on destroy", async () => {
    const owner = mount(Owner, {
      options: { pageFactory },
      onInit: spyOnPeek,
      child: PeekUser,
    });

    owner.$set({ shown: false });
    await tick();

    expect(calls).toHaveLength(1);
    expect(removed).toEqual(calls);
  });

  it("requires an owner", () => {
    expect(() => mount(PeekUser, {})).toThrow(
      "peek requires useAyme() in an ancestor component, such as the root +layout.svelte."
    );
  });
});
