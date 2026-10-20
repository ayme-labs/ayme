// The entry a build without Ayme resolves `@ayme-dev/vue` to: the names of
// the index, backed by the runtime's absent entry, so a component tree
// renders as it does with the real package.
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { Ayme } from "@ayme-dev/ayme";

const { sessions } = vi.hoisted(() => ({ sessions: [] as Ayme[] }));
vi.mock("@ayme-dev/ayme/absent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@ayme-dev/ayme/absent")>();
  return {
    ...original,
    createAyme: (...args: Parameters<typeof original.createAyme>) => {
      const session = original.createAyme(...args);
      vi.spyOn(session, "peek");
      sessions.push(session);
      return session;
    },
  };
});
import * as absent from "./absent";
import {
  AymeProvider,
  useAyme,
  usePageObject,
  usePeek,
  type UseAymeResult,
} from "./absent";
import type * as index from "./index";

class Model {
  constructor() {
    throw new Error(
      "Page Objects are not constructed in a build without Ayme."
    );
  }
}

const apps: App[] = [];
function mount(root: Parameters<typeof createApp>[0]) {
  const app = createApp(root);
  apps.push(app);
  const element = document.createElement("div");
  app.mount(element);
  return element;
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  sessions.length = 0;
  vi.restoreAllMocks();
});

it("exports every name of the index, with its types", async () => {
  const real = await import("./index");
  expect(Object.keys(absent).sort()).toEqual(Object.keys(real).sort());
  const surface: typeof index = absent;
  void surface;
});

it("renders the provider's children with an inert session, a Page Object of the model's class and no Peek", async () => {
  let result: UseAymeResult | undefined;
  let model: object | undefined;
  const Child = defineComponent({
    setup() {
      result = useAyme();
      model = usePageObject(Model);
      usePeek({ count: 0 }, "counter");
      return () => h("output", result!.webMCP.publicationStatus.state);
    },
  });
  const element = mount({
    render: () =>
      h(AymeProvider, { webMCP: { enabled: false } }, () => h(Child)),
  });
  await nextTick();

  expect(element.innerHTML).toBe("<output>disabled</output>");
  expect(result!.ayme.tools.list()).toEqual([]);
  expect(model).toBeInstanceOf(Model);
  expect(sessions.length).toBeGreaterThan(0);
  for (const session of sessions) expect(session.peek).not.toHaveBeenCalled();
});

it("normalises the provider's props as the index does, so a kebab-case attribute reaches the absent runtime", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const element = mount({
    render: () =>
      h(AymeProvider, { "web-m-c-p": { enabled: true } }, () =>
        h("output", "rendered")
      ),
  });

  expect(element.innerHTML).toBe("<output>rendered</output>");
  expect(logged).toHaveBeenCalledWith(
    "Ayme was removed from this build, but setup enables WebMCP publication."
  );
});

it("passes a standalone owner's options to the absent runtime, which logs the publication error", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const Root = defineComponent({
    setup() {
      const { webMCP } = useAyme({ webMCP: { enabled: true } });
      return () => h("output", webMCP.publicationStatus.state);
    },
  });
  expect(mount(Root).innerHTML).toBe("<output>disabled</output>");
  expect(logged).toHaveBeenCalledWith(
    "Ayme was removed from this build, but setup enables WebMCP publication."
  );
});
