import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RecorderWindow } from "@ayme-dev/recorder-window/testing";
import { chromium } from "@playwright/test";

import { CartPage } from "../.ayme/pom/CartPage";
import { expect, personAt, test } from "./fixtures";
import { stockTraceTool } from "./stockTrace";

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
      // Playwright learns of a page and its address a moment after the
      // browser lists it.
      const pageAt = async (url: string) => {
        const find = () =>
          browser
            .contexts()
            .flatMap((context) => context.pages())
            .find((page) => page.url() === url);
        await expect.poll(() => find() !== undefined).toBe(true);
        return find()!;
      };
      expect(
        await (
          await pageAt(windowUrl!)
        ).evaluate(() => "__aymeRecorderHeld" in globalThis)
      ).toBe(false);
      expect(
        await (
          await pageAt(fixturePages.url())
        ).evaluate(() => "__aymeRecorderHeld" in globalThis)
      ).toBe(true);
      // It is the recorder's window, live.
      await expect(
        new RecorderWindow(await pageAt(windowUrl!)).controls.recordButton
      ).toBeEnabled();

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
      await expect(
        new RecorderWindow(windowPage).controls.recordButton
      ).toBeEnabled();

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

  test("--start-recording opens already recording: the package and its trace hold the first page load, and Finish saves them", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    test.setTimeout(60_000);
    // A project of the test's own, inside this app: its Playwright is the
    // app's, and its recordings are the test's.
    const project = testInfo.outputPath("project");
    await mkdir(project, { recursive: true });
    const url = fixturePages.url("/cart.html");
    const run = await runRecorder(["codegen", url, "--start-recording"], {
      cwd: project,
    });
    await run.waitForStdout("Recorder UI: ");
    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      const pageAt = async (at: string) => {
        const find = () =>
          browser
            .contexts()
            .flatMap((context) => context.pages())
            .find((page) => page.url() === at);
        await expect.poll(() => find() !== undefined).toBe(true);
        return find()!;
      };
      const window = new RecorderWindow(
        await pageAt(windowUrlOf(run.stdout())!)
      );
      // Recording, with nothing pressed.
      await expect(window.controls.stopButton).toBeEnabled();
      await expect(window.controls.recordButton).toHaveCount(0);

      const page = await pageAt(url);
      const cart = new CartPage(page);
      const person = personAt(await page.context().newCDPSession(page));
      await person.click(cart.addItemButton);
      await expect(cart.itemCount).toHaveText("Items: 1");
      await window.controls.finishButton.click();
      expect(await run.exit).toEqual({ code: 0, signal: null });
    } finally {
      await browser.close();
    }

    const saved = /^Recording package: (.*)$/m.exec(run.stdout())?.[1];
    expect(saved).toBeDefined();
    const text = await readFile(saved!, "utf8");
    // The first Visit is the first page load.
    expect(text).toMatch(
      new RegExp(
        `visits:\\n  - visitId: \\w+\\n    url: ${url.replaceAll(".", "\\.")}\\n    cause: initial\\n`
      )
    );
    expect(text).toContain("kind: interaction");
    // The trace holds that load's request, which the tool names by its
    // file.
    const stock = await stockTraceTool();
    try {
      await stock.open(join(saved!, "..", "trace.zip"));
      expect(await stock.command("requests")).toMatch(
        /GET\s+200\s+cart\.html\s/
      );
    } finally {
      await stock.close();
    }
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
