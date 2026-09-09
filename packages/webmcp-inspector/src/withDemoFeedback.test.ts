import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import { isAymeLocator } from "@ayme-dev/webmcp/internal";
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
