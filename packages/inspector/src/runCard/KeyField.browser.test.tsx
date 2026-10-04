import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RunnableTool } from "../adapter/runnableTools";
import { renderPart } from "../testing/renderPart";
import { RunCard as RunCardPart } from "../testing";
import { RunCard } from "./RunCard";

// Component tests: press_key's key field in a run card, driven through the
// run card's page object on playwright-lite. playwright-lite's key presses
// reach the field as the person's would.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const pressKey: RunnableTool = {
  name: "press_key",
  action: "press_key",
  description: "Press a key on the element that has focus.",
  available: true,
  keyField: "key",
  argumentsSchema: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
  },
};

function renderCard() {
  const onRun = vi.fn();
  unmounts.push(
    renderPart(
      <RunCard
        tool={pressKey}
        available
        head={false}
        runs={[]}
        onRun={onRun}
        onShowRun={() => {}}
      />
    )
  );
  const card = new RunCardPart(
    page.getByRole("form", { name: pressKey.action, exact: true })
  );
  return { card, key: card.keyField(), onRun };
}

describe("recording", () => {
  it("records the key or combo pressed, each replacing the last", async () => {
    const { key } = renderCard();

    for (const [pressed, recorded] of [
      ["F5", "F5"],
      ["Tab", "Tab"],
      ["Shift+Tab", "Shift+Tab"],
      ["Control+c", "ControlOrMeta+C"],
      ["Meta+c", "ControlOrMeta+C"],
      ["Shift", "Shift"],
    ]) {
      await key.record(pressed!);
      await expect.poll(() => key.input.inputValue()).toBe(recorded);
    }
  });

  it("says it's recording, and keeps focus on Tab", async () => {
    const { key } = renderCard();

    await key.record("Tab");

    expect(await key.mode()).toBe("record");
    expect(await key.help.textContent()).toBe(
      "Recording. Press any key or combination. Esc to search instead."
    );
    expect(await key.input.evaluate((input) => input.matches(":focus"))).toBe(
      true
    );
  });

  it("shows the modifiers held, waiting for a key", async () => {
    const { key } = renderCard();
    await key.input.focus();

    await page.keyboard.down("Shift");

    await expect
      .poll(() => key.help.textContent())
      .toBe("Shift + … then a key");
    await page.keyboard.up("Shift");
  });

  it("runs the tool with the key recorded", async () => {
    const { card, key, onRun } = renderCard();

    await key.record("Control+c");
    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({ key: "ControlOrMeta+C" });
  });
});

describe("searching", () => {
  it("switches to search on Esc, listing the keys that match", async () => {
    const { key } = renderCard();

    await key.search("arr");

    expect(await key.mode()).toBe("search");
    expect(await key.options.allTextContents()).toEqual([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ]);
  });

  it("picks the key on Enter, moving through the list with the arrows", async () => {
    const { key } = renderCard();
    await key.search("arr");

    await key.input.press("ArrowDown");
    await key.input.press("Enter");

    await expect.poll(() => key.input.inputValue()).toBe("ArrowDown");
    expect(await key.options.count()).toBe(0);
  });

  it("offers the closest key name for a typo", async () => {
    const { key } = renderCard();

    await key.search("shift+tabb");

    await expect
      .poll(() => key.help.textContent())
      .toBe("“tabb” isn't a key name.");
    expect(await key.fixButton.textContent()).toBe("Use Shift+Tab");
    await key.fixButton.click();
    expect(await key.input.inputValue()).toBe("Shift+Tab");
  });

  it("says so when a key comes before +", async () => {
    const { key } = renderCard();

    await key.search("Tab+a");

    await expect
      .poll(() => key.help.textContent())
      .toBe("Only modifiers can come before +, and Tab isn't one.");
  });

  it("offers Playwright's name for a loose spelling, and sends it", async () => {
    const { card, key, onRun } = renderCard();

    await key.search("ctrl+c");

    await expect
      .poll(() => key.fixButton.textContent())
      .toBe("Use ControlOrMeta+C");
    await key.input.press("Escape");
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith({ key: "ControlOrMeta+C" });
  });

  it("adds no line for a key named as Playwright names it", async () => {
    const { key } = renderCard();

    await key.search("F5");

    expect(await key.help.textContent()).toBe("");
  });
});

describe("leaving", () => {
  it("lets Tab leave the field after Esc, keeping the key", async () => {
    const { card, key } = renderCard();
    // playwright-lite doesn't move focus on Tab: the field must let it.
    const tabs: boolean[] = [];
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") tabs.push(event.defaultPrevented);
    };
    document.addEventListener("keydown", onKey);

    for (const [pressed, recorded] of [
      [undefined, ""],
      ["F5", "F5"],
      ["Control+c", "ControlOrMeta+C"],
      ["Shift", "Shift"],
    ]) {
      await card.runButton.focus();
      if (pressed) await key.record(pressed);
      await key.input.press("Escape");
      await key.input.press("Tab");

      expect(await key.input.inputValue()).toBe(recorded);
    }
    document.removeEventListener("keydown", onKey);
    expect(tabs).toEqual([false, false, false, false]);
  });
});

describe("switching", () => {
  it("switches the mode with the icon", async () => {
    const { key } = renderCard();
    await key.input.focus();

    await key.modeButton.click();
    expect(await key.mode()).toBe("search");
    await key.modeButton.click();
    expect(await key.mode()).toBe("record");
  });

  it("starts recording on every new focus", async () => {
    const { card, key } = renderCard();
    await key.search("F5");

    await card.runButton.focus();
    await key.input.focus();

    expect(await key.mode()).toBe("record");
  });
});
