import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import App from "./App.vue";

// Only App.vue's view switch is under test, so Ayme, the playground and the
// code view are stubbed out.
vi.mock("@ayme-dev/vue", () => ({
  useAyme: () => ({ ayme: { runs: { subscribe: () => () => {} } } }),
}));
const stubs = { ListDemo: true, PeekCheck: true, PageObjectCode: true };

enableAutoUnmount(afterEach);

function stubBrowser() {
  window.dataLayer = [];
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  // jsdom doesn't scroll elements.
  Element.prototype.scrollTo = () => {};
  onTestFinished(() => {
    delete window.dataLayer;
    vi.unstubAllGlobals();
    delete (Element.prototype as Partial<Element>).scrollTo;
  });
}

function mountApp() {
  const wrapper = mount(App, { global: { stubs } });
  const item = (label: string) =>
    wrapper.findAll("button").find((button) => button.text() === label)!;
  // The strip holds two 600px panes, so the code's end is at 600.
  const strip = wrapper.get(".snap-x");
  Object.defineProperty(strip.element, "scrollWidth", { value: 1200 });
  Object.defineProperty(strip.element, "clientWidth", { value: 600 });
  const scrollTo = async (left: number) => {
    strip.element.scrollLeft = left;
    await strip.trigger("scroll");
  };
  return { item, scrollTo };
}

describe("The playground's view switch", () => {
  it("tells analytics when the view changes", async () => {
    stubBrowser();
    const { item } = mountApp();

    await item("Page Object code").trigger("click");
    await item("App").trigger("click");

    expect(window.dataLayer).toEqual([
      { event: "playground_view_switch", view: "code" },
      { event: "playground_view_switch", view: "app" },
    ]);
  });

  it("stays on the app while a slide back from the code leaves its end", async () => {
    stubBrowser();
    const { item, scrollTo } = mountApp();

    await item("Page Object code").trigger("click");
    await scrollTo(600);
    await item("App").trigger("click");
    for (const left of [599.5, 300, 0]) await scrollTo(left);

    expect(window.dataLayer).toEqual([
      { event: "playground_view_switch", view: "code" },
      { event: "playground_view_switch", view: "app" },
    ]);
    expect(item("App").attributes("data-state")).toBe("on");
  });

  it("follows a swipe to either end", async () => {
    stubBrowser();
    const { scrollTo } = mountApp();
    for (const left of [200, 600, 400, 0]) await scrollTo(left);

    expect(window.dataLayer).toEqual([
      { event: "playground_view_switch", view: "code" },
      { event: "playground_view_switch", view: "app" },
    ]);
  });
});
