import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";
import {
  AymeProvider,
  useAyme,
  usePageObject,
  type AymeProviderProps,
} from "./index";

type PageFactory = NonNullable<AymeProviderProps["pageFactory"]>;
type Page = ReturnType<PageFactory>;

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
