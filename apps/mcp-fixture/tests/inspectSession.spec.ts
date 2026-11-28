import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";
import { chromium, selectors, type Browser } from "@playwright/test";

import { expect, test } from "./aymeCommand";

// `ayme inspect`, run as a child process against a real browser: the
// Inspector on a Session, in a window outside the Session's browser, driven
// through the Inspector's own page objects. The test's browser stands in for
// the browser a person opens the address in, and the test's own Playwright
// connection to the Session's browser plays the developer's browser
// automation. The Inspector renders into a closed shadow root; its page
// objects reach it through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

// Each resource registers its cleanup as it is made; every cleanup runs,
// whichever failed, and the first failure is reported.
const cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  const failed: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup().catch((error: unknown) => failed.push(error));
  if (failed.length > 0) throw failed[0];
});

const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

const windowIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+\/inspector)\./.exec(stdout)?.[1];

/** The browser automation, connected to the Session's browser that
 * `ayme open` printed the address of; the connection closes with the
 * test. */
async function automation(opened: string): Promise<Browser> {
  const browser = await chromium.connectOverCDP(addressIn(opened)!);
  cleanups.push(() => browser.close());
  return browser;
}

/** The first line of a listing: the Tab it describes. */
const tabLine = (stdout: string) => stdout.split("\n")[0];

const runOf = (inspector: Inspector, tool: string) =>
  inspector.runs.latest(tool);

/** The Inspector window at `address`, in a page of the test's own browser,
 * which is not the Session's. */
async function openWindow(browser: Browser, address: string) {
  const window = await browser.newPage();
  cleanups.push(() => window.close().catch(() => {}));
  await window.goto(address);
  const inspector = new Inspector(window);
  await inspector.open();
  return { window, inspector };
}

test("prints where the Session's process serves the Inspector window, the same address each time, and in --json", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);

  const inspected = await ayme("inspect");

  const address = windowIn(inspected.stdout);
  expect(inspected).toEqual({
    code: 0,
    stdout: `The Inspector of the Session default is at ${address}.\nOpen that address in a browser. It works until the Session ends.\n`,
    stderr: "",
  });
  expect(await ayme("inspect")).toEqual(inspected);
  expect(JSON.parse((await ayme("inspect", "--json")).stdout)).toEqual({
    ok: true,
    text: inspected.stdout.trimEnd(),
    data: { address },
  });
  const page = await fetch(address!);
  expect(await page.text()).toContain("<title>ayme inspect: default</title>");
});

test("the window shows the Page Object Tree and the tools of the Session's Tab, runs a tool as a Run of the Inspector, and follows a Tab change", async ({
  ayme,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const automated = await automation(opened.stdout);
  const [context] = automated.contexts();
  const shop = context!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );

  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toEqual(expect.arrayContaining(["ShopPage", "Basket"]));
  await inspector.navigator.showLens("Tools");
  // A Session offers its Page Object Tools alone.
  await expect
    .poll(() => inspector.navigator.tools.listed())
    .toEqual({
      "Page object tools": expect.arrayContaining([
        "Basket.add",
        "Basket.clear",
        "ShopPage.readHeading",
      ]),
    });

  await (await inspector.tool("Basket.add")).run({ item: "Milk" });

  const run = runOf(inspector, "Basket.add");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({ icon: "Run by you from the Inspector" });
  await expect(shop.getByRole("listitem")).toHaveText(["Milk"]);
  expect((await ayme("page-objects")).stdout).toContain("listitem: Milk");
  await expect(
    inspector.container.getByRole("button", {
      name: /^Pick (an element )?on (the )?page$/,
    })
  ).toHaveCount(0);

  const { model } = inspector.navigator;
  await inspector.navigator.showLens("Model");
  expect(await model.isNotOnPage(model.object("SignInPage"))).toBe(true);

  const signIn = await context!.newPage();
  await signIn.goto(`${baseURL}/sign-in.html`);

  // The window reads the new Tab as a new page, back on the lens it showed.
  await inspector.navigator.showLens("Model");
  await expect
    .poll(() => model.isNotOnPage(model.object("SignInPage")))
    .toBe(false);
  expect(await model.isNotOnPage(model.object("Basket"))).toBe(true);
});

test("when the last Tab closes, the window clears what it showed and says the Session has no Tab, and shows the next Tab that opens", async ({
  ayme,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const automated = await automation(opened.stdout);
  const [context] = automated.contexts();
  const { inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await inspector.navigator.showLens("Tools");
  await expect
    .poll(() => inspector.navigator.tools.listed())
    .toEqual({ "Page object tools": expect.arrayContaining(["Basket.add"]) });
  const noTab = inspector.container.getByText(
    "This Session has no Tab open. Once a tab is open in its browser, the Inspector shows it."
  );

  await context!.pages()[0]!.close();

  await expect(noTab).toBeVisible();
  expect(await inspector.navigator.tools.listed()).toEqual({});

  const again = await context!.newPage();
  await again.goto(`${baseURL}/shop.html`);

  await inspector.navigator.showLens("Tools");
  await expect
    .poll(() => inspector.navigator.tools.listed())
    .toEqual({ "Page object tools": expect.arrayContaining(["Basket.add"]) });
  await expect(noTab).toHaveCount(0);
});

// Which Caller has the Tab's turn is proved at the scripted browser
// (packages/session/src/inspector.test.ts); here the two Callers' Runs meet
// on one Tab of a real Session.
test("a Run from the window pressed while one of ayme call is under way on the Tab runs there too, each Run with its Caller", async ({
  ayme,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/account.html`);
  const account = (await automation(opened.stdout)).contexts()[0]!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toContain("AccountPage");
  const held = ayme("call", "AccountPage.waitForRelease");
  const command = runOf(inspector, "AccountPage.waitForRelease");
  await expect.poll(() => command.status()).toBe("Running");

  await (await inspector.tool("AccountPage.fail")).run();
  await account.evaluate(() => Object.assign(window, { released: true }));

  expect(await held).toMatchObject({ code: 0 });
  const fromWindow = runOf(inspector, "AccountPage.fail");
  await expect.poll(() => fromWindow.status()).toBe("Failed");
  expect(await fromWindow.caller()).toEqual({
    icon: "Run by you from the Inspector",
  });
  // Runs shows the selected tool's Runs until asked for every Run.
  await inspector.runs.allScope.click();
  expect(await command.status()).toBe("Succeeded");
  expect(await command.caller()).toEqual({ text: "ayme-command" });
});

test("a Run from the window whose action waits on a callback that threw is answered with that error, as ayme call is", async ({
  ayme,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/account.html`);
  const { window, inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  const errors: string[] = [];
  window.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const { error } = JSON.parse(String(payload)) as { error?: string };
      if (error !== undefined) errors.push(error);
    })
  );
  await window.reload();
  await inspector.open();
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toContain("AccountPage");

  await (await inspector.tool("AccountPage.throwInTimer")).run();

  await expect
    .poll(() => errors)
    .toContain("The timer the action waits on failed.");
});

test("hovering a Page Object in the window highlights it on the Session's page", async ({
  ayme,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const shop = (await automation(opened.stdout)).contexts()[0]!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  const highlights = () =>
    shop.evaluate(() => document.querySelectorAll("x-pw-glass").length);
  expect(await highlights()).toBe(0);
  // A row takes hovers once the window knows it is on the page, from the
  // Tab's look: a hover before then highlights nothing, and is not
  // repeated when the look comes.
  const basket = inspector.navigator.model.object("Basket");
  await expect(basket).toHaveAttribute("aria-description", "On this page");

  await basket.hover();

  await expect.poll(highlights).toBeGreaterThan(0);
});

test("the window is never the Tab the Session works on, even when it opens in the Session's own browser", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const [context] = (await automation(opened.stdout)).contexts();
  const window = await context!.newPage();
  await window.goto(windowIn((await ayme("inspect")).stdout)!);

  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab t1: Shop (${baseURL}/shop.html)`
  );
});

test("closing the window leaves the Session as it was; when the Session ends, the window says so", async ({
  ayme,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const first = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await expect
    .poll(() => first.inspector.navigator.model.objectPaths())
    .toContain("Basket");

  await first.window.close();

  expect(await ayme("call", "ShopPage.readHeading")).toMatchObject({
    code: 0,
    stdout: expect.stringContaining('result: "Shop"'),
  });
  const second = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await ayme("close");
  await expect(second.window.getByRole("status")).toHaveText(
    "The Session default was closed. Start a Session with ayme -s=default open or ayme -s=default attach, then run ayme -s=default inspect to inspect it."
  );
  await expect(second.inspector.panel).toHaveCount(0);
});

test("a window whose Session's process was killed stops trying to connect, and says so", async ({
  ayme,
  baseURL,
  browser,
  sessionProcess,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const { window, inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toContain("Basket");

  process.kill(sessionProcess()!, "SIGKILL");

  await expect(window.getByRole("status")).toHaveText(
    "This Inspector lost the Session default. Start it again with ayme -s=default open, then run ayme -s=default inspect.",
    { timeout: 15_000 }
  );
  await expect(inspector.panel).toHaveCount(0);
});

test("an open window shows the Page Objects a Swap brings in, without being opened again", async ({
  ayme,
  project,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const { inspector } = await openWindow(
    browser,
    windowIn((await ayme("inspect")).stdout)!
  );
  await inspector.navigator.showLens("Tools");
  const tools = async () =>
    (await inspector.navigator.tools.listed())["Page object tools"];
  await expect.poll(tools).toContain("ShopPage.readHeading");

  const shopPage = join(project, "ayme", "pom", "ShopPage.ts");
  await writeFile(
    shopPage,
    (await readFile(shopPage, "utf8")).replace("readHeading()", "readTitle()")
  );

  await expect.poll(tools).toContain("ShopPage.readTitle");
  expect(await tools()).not.toContain("ShopPage.readHeading");
});
