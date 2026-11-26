import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { testIn } from "./e2e/fixtures";
import type { Tab } from "./e2e/tab";

// E2E: when the Inspector mounts relative to the runtime session, and what
// its demo mode adds to the calls it sees.

/**
 * Counts the click cues the page shows from now on, on <html>'s
 * `data-click-cues`. A cue is removed once its animation ends, so this
 * counts its additions.
 */
async function countClickCues(page: Tab) {
  await page.front();
  await page.browser.evaluate(() => {
    const root = document.documentElement.dataset;
    root.clickCues = "0";
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && "demoClickCue" in node.dataset)
            root.clickCues = String(Number(root.clickCues) + 1);
    }).observe(document.body, { childList: true });
    return null;
  });
}

/** The page's `<html>`, which carries the click cue count. */
const html = (page: Tab) => page.locator("html");

describe("mounted after the runtime started", () => {
  const test = testIn("inline", "/late.html");

  test("records a run on a Page Object built before it and shows its click cue in demo mode", async ({
    page,
    inspector,
  }) => {
    await countClickCues(page);

    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Succeeded");
    await expect
      .poll(() => run.interactionList())
      .toEqual([
        { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
        { operation: "click", target: "ListPage.addItemButton" },
      ]);
    await expect(await html(page).front()).toHaveAttribute(
      "data-click-cues",
      "1"
    );
  });
});

describe("mounted by the session's inspector option", () => {
  const test = testIn("inline", "/session.html");

  test("unmounts when the session stops and mounts afresh on the next start", async ({
    browser,
    page,
    inspector,
  }) => {
    const hosts = page.locator("ayme-inspector");
    await expect(await inspector.header.title.front()).toBeVisible();
    await expect(await hosts.front()).toHaveCount(1);

    await browser.evaluate(() => {
      (window as unknown as { stopAyme(): void }).stopAyme();
      return null;
    });
    await expect(await hosts.front()).toHaveCount(0);

    await browser.evaluate(() => {
      (window as unknown as { startAyme(): void }).startAyme();
      return null;
    });
    await expect(await hosts.front()).toHaveCount(1);
    await expect(await inspector.header.title.front()).toBeVisible();
  });
});

describe("with the inspector option on, without demo", () => {
  const test = testIn("inline", "/session.html", { connected: true });

  test("adds no click cue to an agent's call or a run, and records the run", async ({
    mcpServer,
    page,
    inspector,
    listPage,
  }) => {
    await countClickCues(page);

    await mcpServer!.call("ListPage.addItem", { text: "Eggs" });
    await expect(await listPage.items.front()).toHaveText(["Eggs"]);
    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Succeeded");
    await expect(await listPage.items.front()).toHaveText(["Eggs", "Milk"]);
    await expect(await html(page).front()).toHaveAttribute(
      "data-click-cues",
      "0"
    );
  });
});

describe("with the inspector option in demo mode", () => {
  const test = testIn("inline", "/session.html?demo", { connected: true });

  test("shows the click cue of an agent's call", async ({
    mcpServer,
    page,
    listPage,
  }) => {
    await countClickCues(page);

    await mcpServer!.call("ListPage.addItem", { text: "Eggs" });

    await expect(await listPage.items.front()).toHaveText(["Eggs"]);
    await expect(await html(page).front()).toHaveAttribute(
      "data-click-cues",
      "1"
    );
  });
});
