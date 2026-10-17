import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import App from "./App.vue";

// Only App.vue's view switch is under test, so Ayme, the playground and the
// code view are stubbed out.
vi.mock("@ayme-dev/vue", () => ({ useAyme: vi.fn(), usePageObject: vi.fn() }));
const stubs = { ListDemo: true, PeekCheck: true, PageObjectCode: true };

enableAutoUnmount(afterEach);

describe("The playground's view switch", () => {
  it("tells analytics when the view changes", async () => {
    window.dataLayer = [];
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    // jsdom doesn't scroll elements.
    Element.prototype.scrollTo = () => {};
    onTestFinished(() => {
      delete window.dataLayer;
      vi.unstubAllGlobals();
      delete (Element.prototype as Partial<Element>).scrollTo;
    });
    const wrapper = mount(App, { global: { stubs } });
    const item = (label: string) =>
      wrapper.findAll("button").find((button) => button.text() === label)!;

    await item("Page Object code").trigger("click");
    await item("App").trigger("click");

    expect(window.dataLayer).toEqual([
      { event: "playground_view_switch", view: "code" },
      { event: "playground_view_switch", view: "app" },
    ]);
  });
});
