import { expect, test } from "./fixtures";

// E2E: when the Inspector mounts relative to the runtime session.

test.describe("mounted after the runtime started", () => {
  test.use({ fixturePath: "/late.html" });

  test("records a run on a Page Object built before it and shows its click cue", async ({
    page,
    inspector,
  }) => {
    // The cue is removed once its animation ends, so count its additions.
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

    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.stepList()).toEqual([
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
