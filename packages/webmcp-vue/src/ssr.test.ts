// @vitest-environment node
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listRegisteredPoms } from "@ayme-dev/webmcp/internal";
import {
  AymeWebMcpProvider,
  useAymeWebMcp,
  usePageObject,
  type UseAymeWebMcpOptions,
} from "./index";

type PageFactory = NonNullable<UseAymeWebMcpOptions["page"]>;
type Page = ReturnType<PageFactory>;

afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])("server rendering with publish=%s", (publish) => {
  it.each(["provider", "standalone"])(
    "renders concurrent requests with a %s owner without constructing or registering Page Objects or calling the page factory",
    async (kind) => {
      vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", publish);
      const pageFactory = vi.fn<PageFactory>(() => {
        throw new Error("The page factory must not run on the server.");
      });
      let constructions = 0;
      class ServerModel {
        constructor(readonly page: Page) {
          constructions += 1;
          throw new Error(
            "Page Objects must not be constructed on the server."
          );
        }
        increment() {
          throw new Error("Page Object actions are browser-only.");
        }
      }
      // SSR must not require compiler-derived browser metadata.
      const Content = defineComponent({
        setup() {
          const { publicationStatus } = useAymeWebMcp(
            kind === "standalone" ? { page: pageFactory } : {}
          );
          const model = usePageObject(ServerModel);
          expect(model).toBeInstanceOf(ServerModel);
          return () =>
            h(
              "button",
              { onClick: () => model.increment() },
              publicationStatus.value.state
            );
        },
      });
      const Root = defineComponent({
        setup() {
          return kind === "provider"
            ? () =>
                h(
                  AymeWebMcpProvider,
                  { page: pageFactory },
                  { default: () => h(Content) }
                )
            : () => h(Content);
        },
      });
      const rendered = await Promise.all([
        renderToString(createSSRApp(Root)),
        renderToString(createSSRApp(Root)),
      ]);
      for (const html of rendered)
        expect(html).toContain(`>${publish ? "waiting" : "disabled"}</button>`);
      expect(constructions).toBe(0);
      expect(pageFactory).not.toHaveBeenCalled();
      expect(listRegisteredPoms()).toHaveLength(0);
    }
  );
});
