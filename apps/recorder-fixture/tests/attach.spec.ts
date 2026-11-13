import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { RecorderWindow } from "@ayme-dev/recorder-window/testing";

import { expect, test } from "./fixtures";

test.describe("recording a running browser", () => {
  test("codegen --cdp-endpoint attaches without navigating the page, and the browser stays open and usable when it ends", async ({
    fixturePages,
    runningBrowser,
    runRecorder,
  }) => {
    const { cdpEndpoint, page } = await runningBrowser(
      fixturePages.url("/cart.html")
    );
    await page.locator("#add").click();
    const requests = fixturePages.requests.length;

    const run = await runRecorder(["codegen", "--cdp-endpoint", cdpEndpoint]);
    await run.waitForStdout(`Attached to the browser at ${cdpEndpoint}.`);
    // The window's address is printed, and nothing is opened in the
    // browser: it is someone else's.
    await run.waitForStdout("Recorder window: http://127.0.0.1:");
    const targets = (await (
      await fetch(`${cdpEndpoint}/json/list`)
    ).json()) as { type: string }[];
    expect(targets.filter((target) => target.type === "page")).toHaveLength(1);
    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain("Nothing was recorded.");
    expect(run.stderr()).toBe("");
    // Not loaded again: what was done on the page before is still there.
    expect(fixturePages.requests).toHaveLength(requests);
    await expect(page.getByText("Items: 1")).toBeVisible();
    await page.locator("#add").click();
    await expect(page.getByText("Items: 2")).toBeVisible();
  });

  test("codegen --cdp-endpoint records the running browser's page and saves the package, and the browser goes on", async ({
    fixturePages,
    runningBrowser,
    runRecorder,
    page: windowPage,
  }, testInfo) => {
    const { cdpEndpoint, page } = await runningBrowser(
      fixturePages.url("/cart.html")
    );
    // A project of the test's own, inside this app, so the recorder finds
    // its Playwright and saves there.
    const project = testInfo.outputPath("project");
    await mkdir(project, { recursive: true });
    const run = await runRecorder(["codegen", "--cdp-endpoint", cdpEndpoint], {
      cwd: project,
    });
    await run.waitForStdout("Recorder window: http://127.0.0.1:");
    const windowUrl = /^Recorder window: (\S+)$/m.exec(run.stdout())![1]!;
    const window = new RecorderWindow(windowPage);
    await window.open(windowUrl);

    await window.controls.press("Record");
    await expect(window.controls.status).toHaveText("Recording");
    // At once: "Recording" is shown only when a click is certain to be
    // recorded.
    await page.locator("#add").click();
    await expect(page.getByText("Items: 1")).toBeVisible();
    await expect(window.timeline.visit(0).entries).toHaveCount(1);
    await window.controls.press("Finish");

    expect(await run.exit).toEqual({ code: 0, signal: null });
    const [, packagePath] = /^Recording package: (.*)$/m.exec(run.stdout())!;
    expect(packagePath).toMatch(/\/rec_[0-9TZ]+\/package\.yaml$/);
    expect(packagePath!.startsWith(join(project, ".ayme", "recordings"))).toBe(
      true
    );
    const text = await readFile(packagePath!, "utf8");
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
    expect(text).toContain(
      `targetSelector: internal:role=button[name="Add item"i]`
    );
    // The browser is someone else's: it stays open, and the page goes on.
    await page.locator("#add").click();
    await expect(page.getByText("Items: 2")).toBeVisible();
  });

  test.describe(() => {
    test.use({ recordedBrowser: "attach" });

    test("clicks another automation client gives in that browser are recorded like a person's, and the browser goes on after Finish", async ({
      startRecording,
    }) => {
      const { recorder, page } = await startRecording("/cart.html");
      expect(await recorder.send({ type: "record" })).toBe("applied");

      // The browser's own client, through its Playwright API.
      await page.locator("#add").click();
      await expect(page.getByText("Items: 1")).toBeVisible();
      await page.waitForTimeout(1_000);
      await page.locator("#add").click();
      await expect(page.getByText("Items: 2")).toBeVisible();

      expect(await recorder.send({ type: "finish" })).toBe("applied");
      const outcome = await recorder.done;
      if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
      const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
      expect(text.match(/kind: interaction/g)).toHaveLength(2);
      expect(text.match(/button "Add item"/g)?.length).toBeGreaterThan(0);

      // Each click reached the page once, and the page goes on as before.
      await page.locator("#add").click();
      await expect(page.getByText("Items: 3")).toBeVisible();
    });
  });
});
