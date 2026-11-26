import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
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
async function automation(address: string): Promise<Browser> {
  const browser = await chromium.connectOverCDP(address);
  cleanups.push(() => browser.close());
  return browser;
}

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
    `Tab: Sign in (${baseURL}/sign-in.html)`
  );
  expect(
    tabLine((await ayme("tools", `--tab=${baseURL}/shop.html`)).stdout)
  ).toBe(`Tab: Shop (${baseURL}/shop.html)`);

  await shop.bringToFront();
  expect(tabLine((await ayme("tools")).stdout)).toBe(
    `Tab: Shop (${baseURL}/shop.html)`
  );

  expect(await ayme("tools", `--tab=${baseURL}/`)).toEqual({
    code: 1,
    stdout: "",
    stderr: `No tab of the Session's browser shows ${baseURL}/. --tab takes the URL a tab shows, as the first line of ayme -s=default page-objects prints it. The open tabs show: ${baseURL}/shop.html, ${baseURL}/sign-in.html.\n`,
  });

  await shop.close();
  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab: Sign in (${baseURL}/sign-in.html)`
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
  cleanups.push(async () => {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
    await rm(profile, { recursive: true, force: true });
  });
  const portFile = join(profile, "DevToolsActivePort");
  await expect.poll(() => existsSync(portFile)).toBe(true);
  return `http://127.0.0.1:${readFileSync(portFile, "utf8").split("\n")[0]}`;
}

test("a Run whose action opens a tab, which hides the Run's own, finishes, on a joined browser without focus emulation of its own", async ({
  ayme,
  baseURL,
}) => {
  const address = await bareChromium(`${baseURL}/tabs.html`);
  expect(await ayme("attach", `--cdp=${address}`)).toMatchObject({ code: 0 });

  expect(await ayme("call", "TabsPage.openTabThenMark")).toEqual({
    code: 0,
    stdout: expect.stringContaining('result: "Marks: 1"'),
    stderr: "",
  });

  // The tab the action opened is the most recently active one now.
  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab: Without ayme (${baseURL}/plain.html)`
  );
  expect(await ayme("detach")).toMatchObject({ code: 0 });
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
