import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

// The compiler plugin in vitest.config.ts registers this POM's manifest.
import { ListPage } from "../../playwright/pom/ListPage";
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import App from "../App.vue";

describe("example lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    });
  });

  it("does not publish when the driver appears after unmount", async () => {
    vi.useFakeTimers();
    const wrapper = mount(
      defineComponent({
        setup() {
          useAymeWebMcp();
          usePageObject(ListPage);
          return () => h("div");
        },
      })
    );
    await flushPromises();
    wrapper.unmount();

    const registerTool = vi.fn(
      async (tool: unknown, options: { signal: AbortSignal }) => {
        void tool;
        void options;
      }
    );
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();

    await flushPromises();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("publishes the demo's tools without loading the relay", async () => {
    const registerTool = vi.fn(async (tool: { name: string }) => {
      void tool;
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    const wrapper = mount(App);
    await flushPromises();

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toContain(
      "ListPage.addItem"
    );
    expect(document.head.querySelector("script[data-ayme-relay]")).toBeNull();
    wrapper.unmount();
  });
});
