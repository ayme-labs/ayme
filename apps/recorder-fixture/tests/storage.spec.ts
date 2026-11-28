import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RecorderWindow } from "@ayme-dev/recorder-window/testing";
import { chromium, type Browser } from "@playwright/test";

import { CartPage } from "#pom/CartPage";
import { LoginPage } from "#pom/LoginPage";
import { expect, personAt, test } from "./fixtures";
import { stockTraceTool } from "./stockTrace";

// --load-storage and --save-storage: the names, the file and the behaviour of
// Playwright's own codegen (#1356). The login page is a stand-in: "Log in"
// sets a cookie and a local storage entry.

/** The window's address, once the command has printed it. */
const windowUrlOf = (stdout: string) =>
  /^Recorder UI: (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(stdout)?.[1];

/** The page at `url` in a browser the test is connected to, once Playwright
 * knows of it. */
async function pageAt(browser: Browser, url: string) {
  const find = () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url() === url);
  await expect.poll(() => find() !== undefined).toBe(true);
  return find()!;
}

/** A storage state file as Playwright writes it. */
type StorageState = {
  cookies: { name: string; value: string; domain: string }[];
  origins: {
    origin: string;
    localStorage: { name: string; value: string }[];
    indexedDB?: unknown[];
  }[];
};
const readState = async (file: string) =>
  JSON.parse(await readFile(file, "utf8")) as StorageState;

/** What the login page sets, as a storage state file holds it. */
const loggedIn = (origin: string) => ({
  cookies: expect.arrayContaining([
    expect.objectContaining({
      name: "session",
      value: "s3cret",
      domain: "127.0.0.1",
    }),
  ]),
  origins: [
    expect.objectContaining({
      origin,
      localStorage: [{ name: "user", value: "ada" }],
    }),
  ],
});

test.describe("ayme capture <url> --save-storage <file>", () => {
  test("saves the cookie and the local storage entry the page set when Finish ends the recorder, and leaves nothing of the save in the recording or its trace", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    test.setTimeout(60_000);
    const project = testInfo.outputPath("project");
    await mkdir(project, { recursive: true });
    const file = testInfo.outputPath("state.json");
    const url = fixturePages.url("/login.html");
    const run = await runRecorder(
      ["capture", url, "--start-recording", "--save-storage", file],
      { cwd: project }
    );
    await run.waitForStdout("Recorder UI: ");
    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      const window = new RecorderWindow(
        await pageAt(browser, windowUrlOf(run.stdout())!)
      );
      const page = await pageAt(browser, url);
      const login = new LoginPage(page);
      const person = personAt(await page.context().newCDPSession(page));
      await person.click(login.logInButton);
      await expect(login.who).toHaveText("Logged in as ada");
      await person.pause();
      // To another origin: no page is left at the login page's, so
      // Playwright reads its local storage from a page of its own.
      await person.click(login.elsewhereLink);
      await expect(new CartPage(page).itemCount).toHaveText("Items: 0");
      await person.pause();

      await window.controls.finishButton.click();
      expect(await run.exit).toEqual({ code: 0, signal: null });
    } finally {
      await browser.close();
    }

    expect(run.stderr()).toBe("");
    const state = await readState(file);
    expect(state).toEqual(loggedIn(new URL(url).origin));
    // As Playwright's codegen saves it: without the page's IndexedDB.
    expect(state.origins[0]!.indexedDB ?? []).toEqual([]);
    // The recording holds the person's two Visits and two clicks, and
    // nothing of the page the save opened.
    const saved = /^Recording package: (.*)$/m.exec(run.stdout())?.[1];
    const text = await readFile(saved!, "utf8");
    expect(text.match(/^ {2}- visitId: /gm)).toHaveLength(2);
    // The second Visit is on the other origin.
    expect(text).toMatch(/url: http:\/\/localhost:\d+\/cart\.html\n/);
    expect(text.match(/kind: interaction$/gm)).toHaveLength(2);
    expect(text).not.toMatch(/url: http:\/\/127\.0\.0\.1:\d+\/\n/);
    // The trace holds the person's two page loads and no other. The save
    // comes after the trace is stopped; Playwright also keeps its own page
    // out of a trace, so this shows what is there, not the order.
    const stock = await stockTraceTool();
    try {
      await stock.open(join(saved!, "..", "trace.zip"));
      const requests = await stock.command("requests");
      expect(requests.match(/^\s*\d+\. .*$/gm)).toEqual([
        expect.stringMatching(/GET\s+200\s+login\.html\s/),
        expect.stringMatching(/GET\s+200\s+cart\.html\s/),
      ]);
    } finally {
      await stock.close();
    }

    // Playwright itself opens the page logged in with that file.
    const own = await chromium.launch();
    try {
      const context = await own.newContext({ storageState: file });
      const page = await context.newPage();
      await page.goto(url);
      await expect(new LoginPage(page).who).toHaveText("Logged in as ada");
    } finally {
      await own.close();
    }
  });

  test("saves them also when nothing was recorded: the recorder can be opened only to log in", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    const file = testInfo.outputPath("state.json");
    const url = fixturePages.url("/login.html");
    const run = await runRecorder(["capture", url, "--save-storage", file]);
    await run.waitForStdout(`Opened ${url}`);
    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      const page = await pageAt(browser, url);
      const login = new LoginPage(page);
      const person = personAt(await page.context().newCDPSession(page));
      await person.click(login.logInButton);
      await expect(login.who).toHaveText("Logged in as ada");

      run.interrupt();
      expect(await run.exit).toEqual({ code: 0, signal: null });
    } finally {
      await browser.close();
    }

    expect(run.stdout()).toContain(
      "Recording was empty; no recording package was created."
    );
    expect(run.stderr()).toBe("");
    expect(await readState(file)).toEqual(loggedIn(new URL(url).origin));
  });

  test("prints one warning when the file cannot be written, and ends as it would", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    // A file where the storage file's folder would be.
    const notAFolder = testInfo.outputPath("not-a-folder");
    await writeFile(notAFolder, "");
    const url = fixturePages.url("/login.html");
    const run = await runRecorder([
      "capture",
      url,
      "--save-storage",
      join(notAFolder, "state.json"),
    ]);
    await run.waitForStdout(`Opened ${url}`);

    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain(
      "Recording was empty; no recording package was created."
    );
    expect(run.stderr()).toMatch(
      /^Warning: The storage state could not be saved\. [^\n]+\n$/
    );
  });
});

test.describe("ayme capture <url> --load-storage <file>", () => {
  test("opens the page with the cookie and the local storage entry of a file Playwright saved", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    const file = testInfo.outputPath("state.json");
    const url = fixturePages.url("/login.html");
    // A project's own login setup, with Playwright.
    const own = await chromium.launch();
    try {
      const context = await own.newContext();
      const page = await context.newPage();
      await page.goto(url);
      const login = new LoginPage(page);
      await login.logInButton.click();
      await expect(login.who).toHaveText("Logged in as ada");
      await context.storageState({ path: file });
    } finally {
      await own.close();
    }

    const run = await runRecorder(["capture", url, "--load-storage", file]);
    await run.waitForStdout(`Opened ${url}`);
    const browser = await chromium.connectOverCDP(run.debugEndpoint);
    try {
      await expect(new LoginPage(await pageAt(browser, url)).who).toHaveText(
        "Logged in as ada"
      );
      run.interrupt();
      expect(await run.exit).toEqual({ code: 0, signal: null });
    } finally {
      await browser.close();
    }
  });

  test("does not start when the file cannot be read: one sentence, and exit code 1", async ({
    fixturePages,
    runRecorder,
  }, testInfo) => {
    const file = testInfo.outputPath("missing.json");
    const run = await runRecorder([
      "capture",
      fixturePages.url("/login.html"),
      "--load-storage",
      file,
    ]);

    expect(await run.exit).toEqual({ code: 1, signal: null });
    expect(run.stderr()).toBe(
      `The storage state in ${file} could not be read: ENOENT: no such file or directory, open '${file}'\n`
    );
    expect(run.stdout()).toBe("");
    expect(fixturePages.requests).toEqual([]);
  });
});
