import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAyme, type Ayme } from "@ayme-dev/ayme";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";
import {
  AymeProvider,
  useAyme,
  usePageObject,
  usePeek,
  type AymeProviderProps,
} from "./index";

const peekCalls = vi.hoisted(() => [] as string[]);
vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createAyme: (...args: Parameters<typeof original.createAyme>) => {
      const ayme: Ayme = original.createAyme(...args);
      ayme.peek = (_read, name) => {
        peekCalls.push(name);
        return () => {};
      };
      return ayme;
    },
  };
});

type PageFactory = NonNullable<AymeProviderProps["pageFactory"]>;
type Page = ReturnType<PageFactory>;

// The server's own session holds the process as its App Process, as in a
// dev server with Peeks: a render whose session claimed it too would throw.
let stopAppProcess = () => {};
beforeEach(() => {
  stopAppProcess = createAyme().start();
});
afterEach(() => stopAppProcess());

describe.each([false, true])(
  "server rendering with webMCP.enabled=%s",
  (publish) => {
    it("C9, C10: renders concurrent requests without constructing or registering Page Objects or calling the page factory", async () => {
      const pageFactory = vi.fn<PageFactory>(() => {
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
      const request = async () =>
        renderToString(
          h(
            AymeProvider,
            { pageFactory, webMCP: { enabled: publish } },
            h(Child)
          )
        );

      const rendered = await Promise.all([request(), request()]);
      for (const html of rendered)
        expect(html).toContain(`>${publish ? "waiting" : "disabled"}</button>`);
      expect(constructions).toBe(0);
      expect(pageFactory).not.toHaveBeenCalled();
      expect(listRegisteredPoms()).toHaveLength(0);
    });

    it("C10: renders the same Page Object identity as a session lookup", () => {
      class Model {
        constructor(readonly page: Page) {}
      }
      registerCompiledPom(Model, {
        className: "Model",
        components: [],
        members: [],
        tools: [],
      });
      function Child() {
        const same = usePageObject(Model) === useAyme().ayme.pom.get(Model);
        return h("output", null, String(same));
      }
      expect(
        renderToString(
          h(AymeProvider, { webMCP: { enabled: publish } }, h(Child))
        )
      ).toContain(">true</output>");
    });
  }
);

it("C12: adds no Peek instance while server rendering", () => {
  function Counter() {
    usePeek({ count: 0 }, "counter");
    return h("output", null, "0");
  }

  expect(renderToString(h(AymeProvider, null, h(Counter)))).toContain(
    ">0</output>"
  );
  expect(peekCalls).toEqual([]);
});
