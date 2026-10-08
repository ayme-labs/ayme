import type { Page } from "@playwright/test";

import { AgentView } from "./agentView";
import { expect, test } from "./fixtures";

// E2E: when the Inspector mounts relative to the runtime session, and what
// its demo mode adds to the calls it sees.

/**
 * Counts the click cues the page shows from now on, on <html>'s
 * `data-click-cues`. A cue is removed once its animation ends, so this
 * counts its additions.
 */
async function countClickCues(page: Page) {
  await page.evaluate(() => {
    const root = document.documentElement.dataset;
    root.clickCues = "0";
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && "demoClickCue" in node.dataset)
            root.clickCues = String(Number(root.clickCues) + 1);
    }).observe(document.body, { childList: true });
  });
}

test.describe("mounted after the runtime started", () => {
  test.use({ fixturePath: "/late.html" });

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
    await expect(page.locator("html")).toHaveAttribute("data-click-cues", "1");
  });
});

test.describe("mounted by the session's inspector option", () => {
  test.use({ fixturePath: "/session.html" });

  test("unmounts when the session stops and mounts afresh on the next start", async ({
    page,
    inspector,
  }) => {
    const hosts = page.locator("ayme-inspector");
    await expect(inspector.header.title).toBeVisible();
    await expect(hosts).toHaveCount(1);

    await page.evaluate(() =>
      (window as unknown as { stopAyme(): void }).stopAyme()
    );
    await expect(hosts).toHaveCount(0);

    await page.evaluate(() =>
      (window as unknown as { startAyme(): void }).startAyme()
    );
    await expect(hosts).toHaveCount(1);
    await expect(inspector.header.title).toBeVisible();
  });
});

test.describe("with the inspector option on, without demo", () => {
  test.use({ fixturePath: "/session.html" });

  test("adds no click cue to an agent's call or a run, and records the run", async ({
    page,
    inspector,
    listPage,
  }) => {
    await countClickCues(page);

    await new AgentView(page).call("ListPage.addItem", { text: "Eggs" });
    await expect(listPage.items).toHaveText(["Eggs"]);
    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Succeeded");
    await expect(listPage.items).toHaveText(["Eggs", "Milk"]);
    await expect(page.locator("html")).toHaveAttribute("data-click-cues", "0");
  });
});

test.describe("with the inspector option in demo mode", () => {
  test.use({ fixturePath: "/session.html?demo" });

  test("shows the click cue of an agent's call", async ({ page, listPage }) => {
    await countClickCues(page);

    await new AgentView(page).call("ListPage.addItem", { text: "Eggs" });

    await expect(listPage.items).toHaveText(["Eggs"]);
    await expect(page.locator("html")).toHaveAttribute("data-click-cues", "1");
  });
});
