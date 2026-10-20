// The entry a build without Ayme resolves `@ayme-dev/react` to: the names of
// the index, backed by the runtime's absent entry, so a component tree
// renders as it does with the real package.
import * as React from "react";
import { createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as TestUtils from "react-dom/test-utils";
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

// React exports act from 18.3; the 18.0 compatibility lane falls back to
// react-dom/test-utils, which React 19 deprecates.
const act: typeof TestUtils.act =
  (React as { act?: typeof TestUtils.act }).act ?? TestUtils.act;

class Model {
  constructor() {
    throw new Error(
      "Page Objects are not constructed in a build without Ayme."
    );
  }
}

const roots: Root[] = [];
function render(element: React.ReactElement) {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  sessions.length = 0;
  vi.restoreAllMocks();
});

it("exports every name of the index, with its types", async () => {
  const real = await import("./index");
  expect(Object.keys(absent).sort()).toEqual(Object.keys(real).sort());
  const surface: typeof index = absent;
  void surface;
});

it("renders the provider's children with an inert session, a Page Object of the model's class and no Peek", () => {
  let result: UseAymeResult | undefined;
  let model: object | undefined;
  function Child() {
    result = useAyme();
    model = usePageObject(Model);
    usePeek({ count: 0 }, "counter");
    return h("output", null, result.webMCP.publicationStatus.state);
  }
  const container = render(
    h(AymeProvider, { webMCP: { enabled: false } }, h(Child))
  );

  expect(container.innerHTML).toBe("<output>disabled</output>");
  expect(result!.ayme.tools.list()).toEqual([]);
  expect(model).toBeInstanceOf(Model);
  expect(sessions.length).toBeGreaterThan(0);
  for (const session of sessions) expect(session.peek).not.toHaveBeenCalled();
});

it("passes the provider's options to the absent runtime, which logs the publication error", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  render(h(AymeProvider, { webMCP: { enabled: true } }, h("p")));
  expect(logged).toHaveBeenCalledWith(
    "Ayme was removed from this build, but setup enables WebMCP publication."
  );
});
