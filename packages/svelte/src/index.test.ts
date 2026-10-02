import { tick } from "svelte";
import { VERSION } from "svelte/compiler";
import { get } from "svelte/store";
import { afterEach, expect, it, vi } from "vitest";
import { createRuntimeSession, RuntimeStateError } from "@ayme-dev/ayme";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";

// A mount that throws leaves its started owners undestroyed, so the tests
// stop every started session themselves.
const stops = vi.hoisted(() => [] as (() => void)[]);
vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createRuntimeSession: vi.fn(
      (options: Parameters<typeof original.createRuntimeSession>[0]) => {
        const session = original.createRuntimeSession(options);
        const start = session.start;
        session.start = () => {
          const stop = start();
          stops.push(stop);
          return stop;
        };
        return session;
      }
    ),
  };
});
import {
  Consumer,
  Owner,
  OwnerAndPageObject,
  PageObjectUser,
  Status,
} from "./fixtures/components.js";
import {
  useAyme,
  usePageObject,
  type UseAymeOptions,
  type UseAymeResult,
} from "./index";

type PageFactory = NonNullable<UseAymeOptions["pageFactory"]>;
type Page = ReturnType<PageFactory>;
const page = {} as Page;
const pageFactory: PageFactory = () => page;
class Model {
  constructor(readonly page: Page) {}
}
registerCompiledPom(Model, {
  className: "Model",
  components: [],
  members: [],
  tools: [],
});

const legacyInternal =
  Number(VERSION.split(".")[0]) < 5
    ? ((await import(/* @vite-ignore */ "svelte/internal" as string)) as {
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
  const target = document.createElement("div");
  let component;
  try {
    component = new Component({ target, props });
  } catch (error) {
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
}
afterEach(() => {
  for (const component of mounted.splice(0).reverse()) component.$destroy();
  for (const stop of stops.splice(0)) stop();
  vi.mocked(createRuntimeSession).mockClear();
  delete (document as { modelContext?: unknown }).modelContext;
});

it("passes the options to the runtime session unchanged", () => {
  const options: UseAymeOptions = {
    pageFactory,
    ignore: (element) => element.matches(".assistant"),
    customTools: [],
    goalLoop: vi.fn(),
    webMCP: { enabled: false, toolNamePrefix: "ayme_" },
  };
  let result: UseAymeResult | undefined;
  mount(Owner, { options, onInit: (value) => (result = value) });
  expect(createRuntimeSession).toHaveBeenCalledExactlyOnceWith(options);
  expect(result?.ayme).toBe(
    vi.mocked(createRuntimeSession).mock.results[0]?.value
  );
});

it("starts the runtime before descendants mount and stops it on destroy", async () => {
  let goalError: unknown;
  let result: UseAymeResult | undefined;
  const owner = mount(Owner, {
    options: { pageFactory },
    onInit: (value) => (result = value),
    child: Consumer,
    childProps: {
      onMounted: ({ ayme }: UseAymeResult) =>
        ayme.pursueGoal("Check", { maxSteps: 1 }).catch((error: unknown) => {
          goalError = error;
        }),
    },
  });
  await vi.waitFor(() => expect(goalError).toBeDefined());
  // A stopped session would reject with "requires a started runtime session".
  expect(goalError).toEqual(
    new RuntimeStateError(
      "pursueGoal requires a goalLoop on the runtime session."
    )
  );
  const { ayme } = result!;
  expect(ayme.webMCP.publicationStatus.state).toBe("disabled");
  destroy(owner);
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
});

it("gives descendants the owner's value and starts nothing more", () => {
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
  expect(createRuntimeSession).toHaveBeenCalledOnce();
});

it("rejects options beneath an owner", () => {
  expect(() =>
    mount(Owner, {
      child: Consumer,
      childProps: { options: {} },
    })
  ).toThrow(
    "Configure Ayme on the ancestor useAyme(options) owner, not beneath it."
  );
});

it("names the root component when a second owner becomes active", () => {
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
    new RuntimeStateError("The Ayme runtime already has an active owner.")
  );
});

it("reads the publication status as a store that follows the session", async () => {
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

it("registers the concrete Page Object while its component lives", async () => {
  const instances: object[] = [];
  const owner = mount(Owner, {
    options: { pageFactory },
    child: PageObjectUser,
    childProps: {
      model: Model,
      onInit: (instance: object) => instances.push(instance),
    },
  });
  expect(instances).toHaveLength(1);
  expect(instances[0]).toBeInstanceOf(Model);
  expect((instances[0] as Model).page).toBe(page);
  expect(listRegisteredPoms()).toHaveLength(1);

  owner.$set({ shown: false });
  await tick();
  expect(listRegisteredPoms()).toHaveLength(0);

  owner.$set({ shown: true });
  await tick();
  expect(instances).toHaveLength(2);
  expect(instances[1]).not.toBe(instances[0]);
  expect(listRegisteredPoms()).toHaveLength(1);

  destroy(owner);
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("lets the owner use a Page Object in its own component", () => {
  let result: (UseAymeResult & { pageObject: object }) | undefined;
  const owner = mount(OwnerAndPageObject, {
    options: { pageFactory },
    model: Model,
    onInit: (value) => (result = value),
  });
  expect(result?.pageObject).toBeInstanceOf(Model);
  expect(listRegisteredPoms()).toHaveLength(1);
  destroy(owner);
  expect(listRegisteredPoms()).toHaveLength(0);
  expect(result?.ayme.webMCP.publicationStatus.state).toBe("disposed");
});

it("requires an owner for a Page Object", () => {
  expect(() => mount(PageObjectUser, { model: Model })).toThrow(
    "usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte."
  );
});

it("leaves calls outside component initialisation to Svelte's own error", () => {
  expect(() => useAyme()).toThrow(
    /lifecycle_outside_component|outside component initiali[sz]ation/
  );
  expect(() => usePageObject(Model)).toThrow(
    /lifecycle_outside_component|outside component initiali[sz]ation/
  );
  expect(createRuntimeSession).not.toHaveBeenCalled();
});
