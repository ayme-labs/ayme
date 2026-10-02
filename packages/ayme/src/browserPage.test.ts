import { afterEach, expect, it, vi } from "vitest";
const { createBrowserPage } = vi.hoisted(() => ({
  createBrowserPage: vi.fn(() => ({})),
}));
vi.mock("@ayme-dev/playwright-lite", () => ({ createPage: createBrowserPage }));
import { createPage } from "./browserPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("does not create a browser Page during import", () => {
  expect(createBrowserPage).not.toHaveBeenCalled();
});
it("uses runtime defaults without compiler settings", () => {
  createPage();
  expect(createBrowserPage).toHaveBeenCalledWith({
    testIdAttribute: undefined,
    actionTimeout: undefined,
    navigationTimeout: undefined,
  });
});
it("passes configured test IDs and explicit zero timeouts without losing them", () => {
  vi.stubGlobal("__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__", "data-pom");
  vi.stubGlobal("__AYME_PLAYWRIGHT_ACTION_TIMEOUT__", 0);
  vi.stubGlobal("__AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__", 37);
  createPage();
  expect(createBrowserPage).toHaveBeenCalledWith({
    testIdAttribute: "data-pom",
    actionTimeout: 0,
    navigationTimeout: 37,
  });
});
it("lets a caller option override the define for that option only", () => {
  vi.stubGlobal("__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__", "data-pom");
  vi.stubGlobal("__AYME_PLAYWRIGHT_ACTION_TIMEOUT__", 20);
  vi.stubGlobal("__AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__", 37);
  createPage({ actionTimeout: 5 });
  expect(createBrowserPage).toHaveBeenLastCalledWith({
    testIdAttribute: "data-pom",
    actionTimeout: 5,
    navigationTimeout: 37,
  });
  createPage({ navigationTimeout: 0 });
  expect(createBrowserPage).toHaveBeenLastCalledWith({
    testIdAttribute: "data-pom",
    actionTimeout: 20,
    navigationTimeout: 0,
  });
  createPage({ testIdAttribute: "data-caller" });
  expect(createBrowserPage).toHaveBeenLastCalledWith({
    testIdAttribute: "data-caller",
    actionTimeout: 20,
    navigationTimeout: 37,
  });
});
it("uses caller options without compiler settings", () => {
  createPage({ testIdAttribute: "data-caller", actionTimeout: 5 });
  expect(createBrowserPage).toHaveBeenCalledWith({
    testIdAttribute: "data-caller",
    actionTimeout: 5,
    navigationTimeout: undefined,
  });
});
