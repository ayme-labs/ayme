import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCompiledPom } from "@ayme-dev/webmcp/internal";
import { ListPage } from "../../playwright/pom/ListPage";
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import App from "../App.vue";

function registerListPage() {
  registerCompiledPom(ListPage, {
    className: "ListPage",
    components: [],
    members: [],
    tools: [
      {
        methodName: "addItem",
        toolName: "ListPage.addItem",
        description: "Add an item.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        parameters: [],
      },
    ],
  });
}

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
    registerListPage();
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
    registerListPage();
    const registerTool = vi.fn(async () => {});
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    const wrapper = mount(App);
    await flushPromises();

    expect(registerTool).toHaveBeenCalled();
    expect(document.head.querySelector("script[data-ayme-relay]")).toBeNull();
    wrapper.unmount();
  });
});
