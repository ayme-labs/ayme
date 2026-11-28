import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import {
  executePublishedTool,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/webmcp/testing";

import { expect, test } from "./aymeCommand";

// The Tabs of a Session, run as a child process against a real browser:
// ayme works on the browser's most recently active Tab, a Page Object Id
// chooses its Tab, and a Run works the same on a Tab that is not in front.
// The test's own Playwright connection plays the developer's browser
// automation.

const cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** The browser automation, connected to the browser at `address`; the
 * connection closes with the test. */
async function automation(
  address: string,
  options?: { noDefaults: true }
): Promise<Browser> {
  const browser = await chromium.connectOverCDP(address, options);
  cleanups.push(() => browser.close());
  return browser;
}

/** How a page reads whether it is in front. */
const inFront = (page: Page) =>
  page.evaluate(() => ({
    focused: document.hasFocus(),
    visibility: document.visibilityState,
  }));

/** The first line of a listing: the Tab it describes. */
const tabLine = (stdout: string) => stdout.split("\n")[0];

test("ayme works on the most recently active Tab, follows the automation to another, and --tab names one by its URL", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const browser = await automation(addressIn(opened.stdout)!);
  const [context] = browser.contexts();
  const shop = context!.pages()[0]!;

  const signIn = await context!.newPage();
  await signIn.goto(`${baseURL}/sign-in.html`);
  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab t1: Sign in (${baseURL}/sign-in.html)`
  );
  expect(
    tabLine((await ayme("tools", `--tab=${baseURL}/shop.html`)).stdout)
  ).toBe(`Tab t2: Shop (${baseURL}/shop.html)`);

  await shop.bringToFront();
  expect(tabLine((await ayme("tools")).stdout)).toBe(
    `Tab t2: Shop (${baseURL}/shop.html)`
  );

  expect(await ayme("tools", `--tab=${baseURL}/`)).toEqual({
    code: 1,
    stdout: "",
    stderr: `No tab of the Session's browser shows ${baseURL}/. --tab takes a tab's id or the URL it shows, as the first line of ayme -s=default page-objects prints them. The open tabs show: ${baseURL}/shop.html, ${baseURL}/sign-in.html.\n`,
  });

  await shop.close();
  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab t1: Sign in (${baseURL}/sign-in.html)`
  );

  await signIn.close();
  const none = {
    code: 1,
    stdout: "",
    stderr:
      "No tab is open in the Session's browser. Open one with your browser automation, then run ayme again.\n",
  };
  expect(await ayme("page-objects")).toEqual(none);
  expect(await ayme("call", "ShopPage.readHeading")).toEqual(none);

  const again = await context!.newPage();
  await again.goto(`${baseURL}/shop.html`);
  expect(await ayme("tools")).toMatchObject({ code: 0 });
});

test("each Tab has an id of the Session's own, which --tab names exactly, also among Tabs at one URL; a URL several Tabs show names the others' ids, and a closed Tab's id is refused", async ({
  ayme,
  baseURL,
}) => {
  const shopUrl = `${baseURL}/shop.html`;
  const opened = await ayme("open", shopUrl);
  const browser = await automation(addressIn(opened.stdout)!);
  const [context] = browser.contexts();
  const first = context!.pages()[0]!;
  expect(tabLine((await ayme("tools")).stdout)).toBe(
    `Tab t1: Shop (${shopUrl})`
  );
  // The automation brings a tab to the front, and a command shows its id.
  const second = await context!.newPage();
  await second.goto(shopUrl);
  expect(tabLine((await ayme("tools")).stdout)).toBe(
    `Tab t2: Shop (${shopUrl})`
  );

  await first.evaluate(() => {
    document.title = "First";
    document.querySelector("h1")!.textContent = "First shop";
  });
  const listed = await ayme("tools", "--tab=t1", "--json");
  expect(JSON.parse(listed.stdout)).toMatchObject({
    ok: true,
    text: expect.stringMatching(/^Tab t1: First \(/),
    data: { tab: { id: "t1", url: shopUrl, title: "First" } },
  });
  expect(await ayme("call", "ShopPage.readHeading", "--tab=t1")).toEqual({
    code: 0,
    stdout: 'settled: true\nresult: "First shop"\n',
    stderr: "",
  });

  const several = `Tabs t2 and t1 show ${shopUrl}: ayme chose t2, the most recently active. Name another by its id, as --tab=t1. To see which tab has which id, bring it to the front with your browser automation and run ayme -s=default page-objects: its first line shows its id.`;
  const byUrl = await ayme("page-objects", `--tab=${shopUrl}`);
  expect(byUrl.stdout.split("\n").slice(0, 2)).toEqual([
    `Tab t2: Shop (${shopUrl})`,
    several,
  ]);
  expect(byUrl.stdout).toContain(
    "ayme -s=default tools --tab=t2 lists them with their parameters."
  );

  await second.close();
  const toDo =
    "Bring the tab you want to the front with your browser automation and run ayme -s=default page-objects: it works on that tab, and its first line shows the tab's id.";
  expect(await ayme("tools", "--tab=t2")).toEqual({
    code: 1,
    stdout: "",
    stderr: `No open tab of the Session's browser has the id t2 now: the tab was closed, or it shows the Inspector. ${toDo}\n`,
  });
  expect(await ayme("call", "ShopPage.readHeading", "--tab=t3")).toEqual({
    code: 1,
    stdout: "",
    stderr: `This Session gave no tab the id t3. ${toDo}\n`,
  });

  // A page load keeps the Tab's id.
  await first.goto(`${baseURL}/sign-in.html`);
  expect(tabLine((await ayme("tools", "--tab=t1")).stdout)).toBe(
    `Tab t1: Sign in (${baseURL}/sign-in.html)`
  );
});

test("a Page Object Id is unique across the Session's Tabs and chooses its Tab; a closed Tab's ids are gone, and a new Session starts them again", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html?one`);
  const browser = await automation(addressIn(opened.stdout)!);
  const [context] = browser.contexts();
  const one = context!.pages()[0]!;
  const two = await context!.newPage();
  await two.goto(`${baseURL}/shop.html?two`);

  expect((await ayme("page-objects")).stdout).toContain("Basket po1\n");
  expect(
    (await ayme("page-objects", `--tab=${baseURL}/shop.html?one`)).stdout
  ).toContain("Basket po2\n");

  // The Tab in front is two; the id chooses one.
  expect(
    await ayme(
      "call",
      "Basket.add",
      "--params",
      '{"id": "po2", "args": {"item": "Milk"}}'
    )
  ).toMatchObject({ code: 0 });
  await expect(one.getByRole("listitem")).toHaveText(["Milk"]);
  await expect(two.getByRole("listitem")).toHaveCount(0);

  await one.close();
  expect(
    await ayme(
      "call",
      "Basket.add",
      "--params",
      '{"id": "po2", "args": {"item": "Tea"}}'
    )
  ).toEqual({
    code: 1,
    stdout: "",
    stderr:
      'RefResolutionError: Cannot call Basket.add on Page Object "po2": it is not on the page.\n',
  });
  expect((await ayme("page-objects")).stdout).toContain("Basket po1\n");

  expect(await ayme("close")).toMatchObject({ code: 0 });
  await ayme("open", `${baseURL}/shop.html?two`);
  expect((await ayme("page-objects")).stdout).toContain("Basket po1\n");
});

/**
 * A Chromium of the automation's own at `url`, started without Playwright,
 * so nothing has turned focus emulation on in it: headless, but Chromium's
 * own build, whose background tabs are hidden and draw no frames.
 */
async function bareChromium(url: string): Promise<string> {
  const profile = await mkdtemp(join(tmpdir(), "ayme-bare-"));
  const child = spawn(
    chromium.executablePath(),
    [
      "--headless",
      // CI runs as root in a container, where the sandbox cannot start.
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: "ignore" }
  );
  // Heard from the start: Chromium may exit, or never start, before the
  // test ends, and an unheard "error" would end the test's worker.
  const ended = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  cleanups.push(async () => {
    try {
      const running =
        child.pid !== undefined &&
        child.exitCode === null &&
        child.signalCode === null;
      if (running) {
        child.kill();
        await ended;
      }
    } finally {
      // On Linux, Chromium's helper processes may still write into the
      // profile after the main one exited, so its removal tries again.
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    }
  });
  const portFile = join(profile, "DevToolsActivePort");
  await expect.poll(() => existsSync(portFile)).toBe(true);
  return `http://127.0.0.1:${readFileSync(portFile, "utf8").split("\n")[0]}`;
}

test("a Run whose action opens a tab, which hides the Run's own, finishes, on a joined browser without focus emulation of its own; after detach, a background Tab reads as it did before attach", async ({
  ayme,
  baseURL,
}) => {
  const address = await bareChromium(`${baseURL}/tabs.html`);
  // Without Playwright's defaults, so it turns no focus emulation on itself.
  const [context] = (
    await automation(address, { noDefaults: true })
  ).contexts();
  const [tabs] = context!.pages();
  const background = await context!.newPage();
  await background.goto(`${baseURL}/sign-in.html`);
  await tabs!.bringToFront();
  const before = await inFront(background);
  expect(before).toEqual({ focused: false, visibility: "hidden" });

  expect(await ayme("attach", `--cdp=${address}`)).toMatchObject({ code: 0 });
  // The Session works on the background Tab, which turns focus emulation on
  // for it; the Tab in front stays the most recently active one.
  expect(
    await ayme("page-objects", `--tab=${baseURL}/sign-in.html`)
  ).toMatchObject({ code: 0 });
  expect(await inFront(background)).toEqual({
    focused: true,
    visibility: "visible",
  });

  expect(await ayme("call", "TabsPage.openTabThenMark")).toEqual({
    code: 0,
    stdout: expect.stringContaining('result: "Marks: 1"'),
    stderr: "",
  });

  // The tab the action opened is the most recently active one now.
  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab t3: Without ayme (${baseURL}/plain.html)`
  );
  expect(await ayme("detach")).toMatchObject({ code: 0 });

  // Chromium let go of the focus emulation with the Session's connection.
  expect(await inFront(background)).toEqual(before);
});

test("on an app that ships ayme, the page's own runtime and the Session are two Hosts, each with Page Object Ids of its own", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open");
  const browser = await automation(addressIn(opened.stdout)!);
  const [context] = browser.contexts();
  await recordPublishedTools(context!);
  const app = context!.pages()[0]!;
  await app.goto(`${baseURL}/?webmcp&class-tools`);
  await app.getByRole("button", { name: "Show basket" }).click();
  await app.getByRole("button", { name: "Fill basket" }).click();
  await app.getByRole("button", { name: "Fill basket" }).click();

  // The Session's own Page Object, with the Session's first id.
  expect((await ayme("page-objects")).stdout).toContain("GroceryList po1\n");
  // The page's runtime gives its own ids to its own Page Objects: its po1
  // is a row, which its tool removes.
  await waitForPublishedTool(app, "BasketItem.remove");
  await executePublishedTool(app, "BasketItem.remove", { id: "po1" });
  await expect(app.getByRole("listitem")).toHaveCount(1);

  // The Session's po1 is still its list.
  expect(
    await ayme("call", "GroceryList.count", "--params", '{"id": "po1"}')
  ).toMatchObject({ code: 0, stdout: expect.stringContaining("result: 1") });
});
