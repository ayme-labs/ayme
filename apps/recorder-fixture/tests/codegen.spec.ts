import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RecorderWindow } from "@ayme-dev/recorder-window/testing";
import { chromium } from "@playwright/test";

import { expect, test } from "./fixtures";

/** The window's address, once the command has printed it. */
const windowUrlOf = (stdout: string) =>
  /^Recorder UI: (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(stdout)?.[1];

test.describe("codegen <url>", () => {
  test("opens the page in Chromium and ends with 'empty' when it is stopped from the terminal", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    expect(fixturePages.requests).toContainEqual({
      path: "/",
      userAgent: expect.stringContaining("Chrome/"),
    });

    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain(
      "Recording was empty; no recording package was created."
    );
    expect(run.stderr()).toBe("");
  });

  test("prints the window's address, and opens the window as a second window of the browser it launched, apart from what it records", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout("Recorder UI: ");
    const windowUrl = windowUrlOf(run.stdout());
    expect(windowUrl).toBeDefined();

    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      // The browser's own list of its pages, with the context of each.
      const cdp = await browser.newBrowserCDPSession();
      const pages = async () =>
        (await cdp.send("Target.getTargets")).targetInfos.filter(
          (target) => target.type === "page"
        );
      await expect
        .poll(async () => (await pages()).map((target) => target.url).sort())
        .toEqual([fixturePages.url(), windowUrl].sort());
      const contextOf = async (url: string) =>
        (await pages()).find((target) => target.url === url)!.browserContextId;
      // A context of its own: the recorder's page hooks, Playwright's
      // recorder and the trace are all the recorded context's.
      expect(await contextOf(windowUrl!)).not.toBe(
        await contextOf(fixturePages.url())
      );
      const pageAt = (url: string) =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url() === url)!;
      expect(
        await pageAt(windowUrl!).evaluate(
          () => "__aymeRecorderHeld" in globalThis
        )
      ).toBe(false);
      expect(
        await pageAt(fixturePages.url()).evaluate(
          () => "__aymeRecorderHeld" in globalThis
        )
      ).toBe(true);
      // It is the recorder's window, live.
      await expect(
        new RecorderWindow(pageAt(windowUrl!)).controls.status
      ).toHaveText("Not recording");

      run.interrupt();
      expect(await run.exit).toEqual({ code: 0, signal: null });
    } finally {
      await browser.close();
    }
  });

  test("ends with 'empty' when the last page is closed", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    await run.closePage(fixturePages.url());

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain(
      "Recording was empty; no recording package was created."
    );
    expect(run.stderr()).toBe("");
  });

  test("closing the recorded page ends the recorder and closes its window", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout("Recorder UI: ");
    const windowUrl = windowUrlOf(run.stdout())!;
    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      const windowAt = () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url() === windowUrl);
      await expect.poll(windowAt).toBeDefined();
      const windowPage = windowAt()!;
      await expect(new RecorderWindow(windowPage).controls.status).toHaveText(
        "Not recording"
      );

      await run.closePage(fixturePages.url());

      expect(await run.exit).toEqual({ code: 0, signal: null });
      await expect.poll(() => windowPage.isClosed()).toBe(true);
      expect(run.stdout()).toContain(
        "Recording was empty; no recording package was created."
      );
    } finally {
      await browser.close();
    }
  });

  test("a second stop from the terminal does no harm", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    run.interrupt();
    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain(
      "Recording was empty; no recording package was created."
    );
  });

  test("fails with a reason, not a stack trace, in a project with no Playwright installed", async ({
    fixturePages,
    runRecorder,
  }) => {
    // Outside the repository, so no Playwright is installed in it or above
    // it. The command brings none of its own.
    const project = await realpath(
      await mkdtemp(join(tmpdir(), "ayme-recorder-no-playwright-"))
    );
    try {
      const run = await runRecorder(["codegen", fixturePages.url()], {
        cwd: project,
      });

      expect(await run.exit).toEqual({ code: 1, signal: null });
      expect(run.stderr()).toBe(
        `No Playwright is installed in ${project}. The recorder uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".\n`
      );
      expect(run.stdout()).toBe("");
      expect(fixturePages.requests).toEqual([]);
    } finally {
      await rm(project, { recursive: true });
    }
  });
});
