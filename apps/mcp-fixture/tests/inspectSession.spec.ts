import { chmod, readFile, writeFile } from "node:fs/promises";
import { runAyme } from "@ayme-dev/cli/testing";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";
import { chromium, selectors, type Browser } from "@playwright/test";

import { expect, test as base } from "./aymeCommand";

// `ayme inspect`, run as a child process against a real browser: the
// Inspector on a Session, in a window outside the Session's browser, driven
// through the Inspector's own page objects. The test's browser stands in for
// the person's default browser, and the test's own Playwright connection to
// the Session's browser plays the developer's browser automation. The
// Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.
/** The command's fixtures, and `inspect`, which runs `ayme inspect` in the
 * project with the BROWSER the test gives, as the Session's other commands
 * run. */
const test = base.extend<{
  inspect: (browserProgram: string) => ReturnType<typeof runAyme>;
}>({
  inspect: async ({ project, temporary }, use, testInfo) => {
    await use((browserProgram) =>
      runAyme(["inspect"], {
        cwd: project,
        env: {
          ...process.env,
          AYME_CACHE_DIR: testInfo.outputPath("cache"),
          TMPDIR: temporary,
          BROWSER: browserProgram,
        },
      })
    );
  },
});

test.beforeAll(() => registerInspectorSelectors(selectors));

const cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** The window's address `ayme inspect` printed, with the Session's token
 * in its fragment. */
const windowIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+)\.$/m.exec(
    stdout
  )?.[1];

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

/** The Inspector window at `address`, in a page of the test's own browser:
 * the person's default browser, which is not the Session's. */
async function openWindow(browser: Browser, address: string) {
  const window = await browser.newPage();
  cleanups.push(() => window.close().catch(() => {}));
  await window.goto(address);
  const inspector = new Inspector(window);
  await inspector.open();
  return { window, inspector };
}

test("opens the Inspector window, served by the Session's process, in the program BROWSER names", async ({
  ayme,
  inspect,
  baseURL,
}, testInfo) => {
  await ayme("open", `${baseURL}/shop.html`);
  // A stand-in for the person's default browser, which writes down the
  // address it was asked to open.
  const opener = testInfo.outputPath("default-browser.cjs");
  const asked = testInfo.outputPath("asked.txt");
  await writeFile(
    opener,
    `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(asked)}, process.argv[2]);\n`
  );
  await chmod(opener, 0o755);

  const inspected = await inspect(opener);

  const address = windowIn(inspected.stdout);
  expect(inspected).toEqual({
    code: 0,
    stdout: `The Inspector of the Session default opened in your default browser at ${address}.\n`,
    stderr: "",
  });
  await expect
    .poll(() => readFile(asked, "utf8").catch(() => undefined))
    .toBe(address);
  const page = await fetch(address!);
  expect(await page.text()).toContain("<title>ayme inspect: default</title>");
});

test("with BROWSER=none prints where the window is and opens nothing", async ({
  ayme,
  inspect,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);

  expect(await inspect("none")).toEqual({
    code: 0,
    stdout: expect.stringMatching(
      /^The Inspector of the Session default is at http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+\.\n$/
    ),
    stderr: "",
  });
});

test("the window shows the Page Object Tree and the tools of the Session's Tab, runs a tool as a Run of the Inspector, and follows a Tab change", async ({
  ayme,
  inspect,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const automated = await automation(opened.stdout);
  const [context] = automated.contexts();
  const shop = context!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await inspect("none")).stdout)!
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

test("a Run from the window waits for the Run under way on the Tab, whichever Caller started it", async ({
  ayme,
  inspect,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/account.html`);
  const account = (await automation(opened.stdout)).contexts()[0]!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await inspect("none")).stdout)!
  );
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toContain("AccountPage");
  const held = ayme("call", "AccountPage.waitForRelease");
  const command = runOf(inspector, "AccountPage.waitForRelease");
  await expect.poll(() => command.status()).toBe("Running");

  await (await inspector.tool("AccountPage.fail")).run();

  const fromWindow = runOf(inspector, "AccountPage.fail");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await expect(fromWindow.root).toHaveCount(0);
  await account.evaluate(() => Object.assign(window, { released: true }));
  expect(await held).toMatchObject({ code: 0 });
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
  inspect,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/account.html`);
  const { window, inspector } = await openWindow(
    browser,
    windowIn((await inspect("none")).stdout)!
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
  inspect,
  baseURL,
  browser,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const shop = (await automation(opened.stdout)).contexts()[0]!.pages()[0]!;
  const { inspector } = await openWindow(
    browser,
    windowIn((await inspect("none")).stdout)!
  );
  const highlights = () =>
    shop.evaluate(() => document.querySelectorAll("x-pw-glass").length);
  expect(await highlights()).toBe(0);

  await inspector.navigator.model.object("Basket").hover();

  await expect.poll(highlights).toBeGreaterThan(0);
});

test("the window is never the Tab the Session works on, even when it opens in the Session's own browser", async ({
  ayme,
  inspect,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  const [context] = (await automation(opened.stdout)).contexts();
  const window = await context!.newPage();
  await window.goto(windowIn((await inspect("none")).stdout)!);

  expect(tabLine((await ayme("page-objects")).stdout)).toBe(
    `Tab: Shop (${baseURL}/shop.html)`
  );
});

test("closing the window leaves the Session as it was; when the Session ends, the window says so", async ({
  ayme,
  inspect,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const address = windowIn((await inspect("none")).stdout)!;
  const first = await openWindow(browser, address);
  await expect
    .poll(() => first.inspector.navigator.model.objectPaths())
    .toContain("Basket");

  await first.window.close();

  expect(await ayme("call", "ShopPage.readHeading")).toMatchObject({
    code: 0,
    stdout: expect.stringContaining('result: "Shop"'),
  });
  const second = await openWindow(browser, address);
  await ayme("close");
  await expect(second.window.getByRole("status")).toHaveText(
    "The Session default was closed. Start a Session with ayme open or ayme attach, then run ayme -s=default inspect to inspect it."
  );
  await expect(second.inspector.panel).toHaveCount(0);
});
