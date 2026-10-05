import { afterEach, expect, it, vi } from "vitest";

import {
  installRuntimePageInstrumentation,
  instrumentedPage,
} from "./pageInstrumentation";
import type { AymePage } from "./runtime";

vi.mock("@ayme-dev/playwright-lite/internal", () => ({
  isPlaywrightLiteLocator: (value: unknown) =>
    typeof value === "object" && value !== null && "selector" in value,
}));

type FakeLocator = {
  selector: string;
  click(): void;
  nth(index: number): FakeLocator;
  all(): Promise<FakeLocator[]>;
  page(): FakePage;
};
type FakePage = {
  locator(selector: string): FakeLocator;
  keyboard: { press(key: string): void };
  mouse: { click(x: number, y: number): void };
};

const clicks: string[] = [];
// A Page whose locators record their clicks, tagged with how they were made.
function fakePage(by: string): FakePage {
  const page: FakePage = {
    locator: (selector) => {
      const locator: FakeLocator = {
        selector,
        click: () => clicks.push(`${by} ${selector}`),
        nth: (index) => page.locator(`${selector} >> nth=${index}`),
        all: async () => [locator.nth(0)],
        page: () => page,
      };
      return locator;
    },
    keyboard: { press: (key) => clicks.push(`${by} keyboard ${key}`) },
    mouse: { click: (x, y) => clicks.push(`${by} mouse ${x},${y}`) },
  };
  return page;
}
const page = fakePage("raw") as unknown as AymePage;
const traced = fakePage("traced") as unknown as AymePage;
const lateButton = () =>
  instrumentedPage(page).locator("button") as unknown as FakeLocator;
let uninstall = () => {};
const installTracing = () => {
  uninstall = installRuntimePageInstrumentation(() => traced);
};

afterEach(() => {
  uninstall();
  clicks.length = 0;
});

it("routes a locator derived before an instrumentation was installed through it", () => {
  const button = lateButton();
  button.click();
  installTracing();
  button.click();
  uninstall();
  button.click();
  expect(clicks).toEqual(["raw button", "traced button", "raw button"]);
});

it("routes a method saved before an instrumentation was installed through it", () => {
  const button = lateButton();
  const click = button.click.bind(button);
  installTracing();
  click();
  expect(clicks).toEqual(["traced button"]);
});

it("routes all()'s items and a locator's page through a later instrumentation", async () => {
  const button = lateButton();
  const [first] = await button.all();
  const owner = button.page();
  installTracing();
  first!.click();
  owner.locator("link").click();
  expect(clicks).toEqual(["traced button >> nth=0", "traced link"]);
});

it("routes a keyboard and a mouse saved before an instrumentation was installed through it", () => {
  const { keyboard, mouse } = instrumentedPage(page) as unknown as FakePage;
  keyboard.press("a");
  installTracing();
  keyboard.press("b");
  mouse.click(1, 2);
  uninstall();
  keyboard.press("c");
  expect(clicks).toEqual([
    "raw keyboard a",
    "traced keyboard b",
    "traced mouse 1,2",
    "raw keyboard c",
  ]);
});
