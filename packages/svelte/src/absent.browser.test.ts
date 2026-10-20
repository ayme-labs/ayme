// The entry a build without Ayme resolves `@ayme-dev/svelte` to: the names of
// the index, backed by the runtime's absent entry, so a component tree
// renders as it does with the real package. The fixture components import the
// index, which this file points at the absent entry.
import { tick } from "svelte";
import { get } from "svelte/store";
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
vi.mock("./index", () => import("./absent"));
import * as absent from "./absent";
import type * as index from "./index";
import type { UseAymeResult } from "./index";
import {
  Owner,
  PageObjectUser,
  PeekUser,
  Status,
} from "./fixtures/components.js";

class Model {
  constructor() {
    throw new Error(
      "Page Objects are not constructed in a build without Ayme."
    );
  }
}

const mounted: { $destroy(): void }[] = [];
function mount<Props>(
  Component: new (options: { target: Element; props?: Props }) => {
    $destroy(): void;
  },
  props: Props
) {
  const target = document.createElement("div");
  mounted.push(new Component({ target, props }));
  return target;
}
afterEach(() => {
  for (const component of mounted.splice(0)) component.$destroy();
  sessions.length = 0;
  vi.restoreAllMocks();
});

it("exports every name of the index, with its types", async () => {
  const real = await vi.importActual<typeof index>("./index");
  expect(Object.keys(absent).sort()).toEqual(Object.keys(real).sort());
  const surface: typeof index = absent;
  void surface;
});

it("gives the owner an inert session with a disabled status and a consumer a Page Object of the model's class", () => {
  let result: UseAymeResult | undefined;
  let model: object | undefined;
  mount(Owner, {
    options: { webMCP: { enabled: false } },
    onInit: (value) => (result = value),
    child: PageObjectUser,
    childProps: { model: Model, onInit: (value: object) => (model = value) },
  });

  expect(result!.ayme.tools.list()).toEqual([]);
  expect(get(result!.webMCP.publicationStatus).state).toBe("disabled");
  expect(model).toBeInstanceOf(Model);
});

it("renders the owner's children, with the status a consumer reads", () => {
  expect(mount(Owner, { child: Status }).innerHTML).toContain(
    "<p>disabled</p>"
  );
});

it("adds no Peek", async () => {
  mount(Owner, { options: { agentConnection: true }, child: PeekUser });
  await tick();
  expect(sessions.length).toBeGreaterThan(0);
  for (const session of sessions) expect(session.peek).not.toHaveBeenCalled();
});

it("passes the owner's options to the absent runtime, which logs the publication error", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mount(Owner, { options: { webMCP: { enabled: true } } });
  expect(logged).toHaveBeenCalledWith(
    "Ayme was removed from this build, but setup enables WebMCP publication."
  );
});
