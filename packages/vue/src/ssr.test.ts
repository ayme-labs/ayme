// @vitest-environment node
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { listRegisteredPoms } from "@ayme-dev/ayme/internal";
import type { Ayme } from "@ayme-dev/ayme";

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
import {
  AymeProvider,
  useAyme,
  usePageObject,
  usePeek,
  type UseAymeOptions,
} from "./index";

type PageFactory = NonNullable<UseAymeOptions["pageFactory"]>;
type Page = ReturnType<PageFactory>;

describe.each([false, true])(
  "server rendering with webMCP.enabled=%s",
  (publish) => {
    it.each(["provider", "standalone"])(
      "renders concurrent requests with a %s owner without constructing or registering Page Objects or calling the page factory",
      async (kind) => {
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
            const { webMCP } = useAyme(
              kind === "standalone"
                ? { pageFactory, webMCP: { enabled: publish } }
                : {}
            );
            const model = usePageObject(ServerModel);
            expect(model).toBeInstanceOf(ServerModel);
            return () =>
              h(
                "button",
                { onClick: () => model.increment() },
                webMCP.publicationStatus.state
              );
          },
        });
        const Root = defineComponent({
          setup() {
            return kind === "provider"
              ? () =>
                  h(
                    AymeProvider,
                    { pageFactory, webMCP: { enabled: publish } },
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
          expect(html).toContain(
            `>${publish ? "waiting" : "disabled"}</button>`
          );
        expect(constructions).toBe(0);
        expect(pageFactory).not.toHaveBeenCalled();
        expect(listRegisteredPoms()).toHaveLength(0);
      }
    );
  }
);

it.each(["provider", "standalone"])(
  "C12: adds no Peek instance while server rendering with a %s owner",
  async (kind) => {
    const Counter = defineComponent({
      setup() {
        usePeek({ count: 0 }, "counter");
        return () => h("output", "0");
      },
    });
    const Root = defineComponent({
      setup() {
        if (kind === "standalone") useAyme();
        return kind === "provider"
          ? () => h(AymeProvider, null, { default: () => h(Counter) })
          : () => h(Counter);
      },
    });

    expect(await renderToString(createSSRApp(Root))).toContain("<output>0");
    expect(peekCalls).toEqual([]);
  }
);
