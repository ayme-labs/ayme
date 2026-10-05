import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import { isAymeLocator } from "@ayme-dev/ayme/internal";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { withDemoFeedback } from "./withDemoFeedback";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("preserves observation and composition through chained and array locators", async () => {
  document.body.innerHTML = `
    <article><button>First</button></article>
    <article><button>Second</button></article>
  `;
  const page = withDemoFeedback(createPage(), { onTrace: vi.fn() });
  const rows = await page.locator("article").all();
  const button = rows[1]!.getByRole("button").and(page.locator("button"));

  expect(button.page()).toBe(page);
  expect(isAymeLocator(button)).toBe(true);
  expect(resolveLocatorElements(button)).toEqual([
    document.querySelectorAll("button")[1],
  ]);
  expect(
    resolveLocatorElements(
      page
        .locator("article")
        .filter({ has: page.getByRole("button", { name: "Second" }) })
    )
  ).toEqual([document.querySelectorAll("article")[1]]);

  const otherPage = withDemoFeedback(createPage(), { onTrace: vi.fn() });
  expect(() => button.and(otherPage.locator("button"))).toThrow(
    /same frame|different Page/
  );
});

it("forwards fill unchanged and preserves action failures", async () => {
  const rawPage = createPage();
  const rawLocator = rawPage.locator("input");
  vi.spyOn(rawPage, "locator").mockReturnValue(rawLocator);
  const fill = vi.spyOn(rawLocator, "fill").mockResolvedValue();
  const failure = new Error("action failed");
  vi.spyOn(rawLocator, "click").mockRejectedValue(failure);
  const onTrace = vi.fn();
  const page = withDemoFeedback(rawPage, { onTrace });

  await page.locator("input").fill("abc", { timeout: 75 });
  expect(fill).toHaveBeenCalledExactlyOnceWith("abc", { timeout: 75 });
  await expect(page.locator("input").click()).rejects.toBe(failure);
  expect(onTrace.mock.calls.map(([entry]) => entry.operation)).toEqual([
    "fill",
    "click",
  ]);
});

it("delays the delegated action without changing its timeout option", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const rawLocator = rawPage.locator("button");
  vi.spyOn(rawPage, "locator").mockReturnValue(rawLocator);
  const click = vi.spyOn(rawLocator, "click").mockResolvedValue();
  const page = withDemoFeedback(rawPage, {
    beforeActionMs: 50,
    onTrace: vi.fn(),
  });

  const pending = page.locator("button").click({ timeout: 10 });
  await vi.advanceTimersByTimeAsync(49);
  expect(click).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(click).toHaveBeenCalledExactlyOnceWith({ timeout: 10 });
});

it("paces a Page wrapped again by the latest options only", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const rawLocator = rawPage.locator("button");
  vi.spyOn(rawPage, "locator").mockReturnValue(rawLocator);
  const click = vi.spyOn(rawLocator, "click").mockResolvedValue();
  withDemoFeedback(rawPage, { beforeActionMs: 50, onTrace: vi.fn() });
  const page = withDemoFeedback(rawPage, { onTrace: vi.fn() });

  await page.locator("button").click();
  expect(click).toHaveBeenCalledOnce();
});

it.each([
  ["click", []],
  ["dblclick", []],
  ["hover", []],
  ["tap", []],
  ["check", []],
  ["uncheck", []],
  ["setChecked", [true]],
  ["fill", ["abc"]],
  ["clear", []],
  ["press", ["Enter"]],
  ["pressSequentially", ["abc"]],
  ["selectOption", ["a"]],
  ["selectText", []],
  ["setInputFiles", [[]]],
] as const)("pauses before a locator's %s", async (method, args) => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const rawLocator = rawPage.locator("input");
  vi.spyOn(rawPage, "locator").mockReturnValue(rawLocator);
  const action = vi
    .spyOn(rawLocator, method)
    .mockResolvedValue(undefined as never);
  const page = withDemoFeedback(rawPage, {
    beforeActionMs: 50,
    onTrace: vi.fn(),
  });

  const pending = (
    page.locator("input")[method] as (...args: unknown[]) => Promise<unknown>
  )(...args);
  await vi.advanceTimersByTimeAsync(49);
  expect(action).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(action).toHaveBeenCalledOnce();
});

it("pauses before a drag", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const source = rawPage.locator("#source");
  const target = rawPage.locator("#target");
  const dragTo = vi.spyOn(source, "dragTo").mockResolvedValue();
  vi.spyOn(rawPage, "locator").mockImplementation((selector) =>
    selector === "#source" ? source : target
  );
  const page = withDemoFeedback(rawPage, {
    beforeActionMs: 50,
    onTrace: vi.fn(),
  });

  const pending = page.locator("#source").dragTo(page.locator("#target"));
  await vi.advanceTimersByTimeAsync(49);
  expect(dragTo).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(dragTo).toHaveBeenCalledOnce();
});

it("pauses before an action the Page takes by selector", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const click = vi.spyOn(rawPage, "click").mockResolvedValue();
  const page = withDemoFeedback(rawPage, {
    beforeActionMs: 50,
    onTrace: vi.fn(),
  });

  const pending = page.click("button");
  await vi.advanceTimersByTimeAsync(49);
  expect(click).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(click).toHaveBeenCalledExactlyOnceWith("button");
});

it("does not pause what only reads the page", async () => {
  vi.useFakeTimers();
  document.body.innerHTML = "<button>Read</button>";
  const page = withDemoFeedback(createPage(), {
    beforeActionMs: 50,
    onTrace: vi.fn(),
  });

  expect(await page.locator("button").textContent()).toBe("Read");
  expect(await page.locator("button").count()).toBe(1);
});

it("paces and records the Page keyboard's calls", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const press = vi.spyOn(rawPage.keyboard, "press").mockResolvedValue();
  const onTrace = vi.fn();
  const page = withDemoFeedback(rawPage, { beforeActionMs: 50, onTrace });

  const pending = page.keyboard.press("Enter");
  expect(onTrace).toHaveBeenCalledExactlyOnceWith(
    { operation: "keyboard.press", value: "Enter" },
    undefined
  );
  await vi.advanceTimersByTimeAsync(49);
  expect(press).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(press).toHaveBeenCalledExactlyOnceWith("Enter");
});

it("paces and records a navigation", async () => {
  vi.useFakeTimers();
  const rawPage = createPage();
  const goto = vi.spyOn(rawPage, "goto").mockResolvedValue(null);
  const onTrace = vi.fn();
  const page = withDemoFeedback(rawPage, { beforeActionMs: 50, onTrace });

  const pending = page.goto("/list");
  expect(onTrace).toHaveBeenCalledExactlyOnceWith(
    { operation: "goto", value: "/list" },
    undefined
  );
  await vi.advanceTimersByTimeAsync(49);
  expect(goto).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(goto).toHaveBeenCalledOnce();
});
