import { chromium, type Dialog } from "@playwright/test";

import { expect, test } from "./aymeCommand";

// Dialogs during a Session (rules 4 and 5), run as a child process against
// a real browser: ayme answers no dialog, and an action never goes on past
// a dialog it did not answer itself. The test's own Playwright connection
// plays the developer's browser automation, which answers each dialog.

const cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** The browser automation, connected to the browser `ayme open` printed
 * the address of before any action opens a dialog, since Chrome answers no
 * DevTools client that connects while one is open. It keeps each dialog
 * for the test to answer and dismisses none. The connection closes with
 * the test. */
async function automation(opened: string) {
  const browser = await chromium.connectOverCDP(addressIn(opened)!);
  cleanups.push(() => browser.close());
  const context = browser.contexts()[0]!;
  const dialogs: Dialog[] = [];
  context.on("dialog", (dialog) => dialogs.push(dialog));
  return { context, page: context.pages()[0]!, dialogs };
}

const DIALOG_OPEN =
  'A confirm dialog is open on the tab: "Remove Milk from the basket?". Answer it with your browser automation, then run ayme again.';
const AT_RUN = `${DIALOG_OPEN} An action stops at a dialog it does not answer itself: it does nothing more on the page, however the dialog is answered.`;

test("an action that clicks, gets a confirm and has a second click after it ends at the confirm: ayme call says a dialog is open, and once the automation accepts it, the second click never comes", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { page, dialogs } = await automation(opened.stdout);

  expect(await ayme("call", "DialogPage.removeThenMark")).toEqual({
    code: 1,
    stdout: "",
    stderr: `${AT_RUN}\n`,
  });
  expect(dialogs.map((dialog) => dialog.message())).toEqual([
    "Remove Milk from the basket?",
  ]);
  expect(await ayme("tools")).toEqual({
    code: 1,
    stdout: "",
    stderr: `Tab: ${baseURL}/dialogs.html\n${DIALOG_OPEN}\n`,
  });

  await dialogs[0]!.accept();

  // The listing waits for the stopped action to end, and tells nothing of it.
  const listing = await ayme("page-objects");
  expect(listing).toMatchObject({ code: 0, stderr: "" });
  expect(listing.stdout).toMatch(/^Tab: Dialogs \(/);
  expect(listing.stdout).not.toMatch(/dialog is open|stop/i);
  expect(await page.locator("#answer").textContent()).toBe("accepted");
  expect(await page.locator("#marks").textContent()).toBe("0");
});

test.describe("an action that answers its own dialog", () => {
  // The action answers in milliseconds; a dialog counts as open only after
  // this long here, so the test holds on a slow machine.
  const before = process.env["AYME_DIALOG_OPEN_MS"];
  test.beforeAll(() => {
    process.env["AYME_DIALOG_OPEN_MS"] = "5000";
  });
  test.afterAll(() => {
    if (before === undefined) delete process.env["AYME_DIALOG_OPEN_MS"];
    else process.env["AYME_DIALOG_OPEN_MS"] = before;
  });

  test("goes on: its second click comes, and ayme call prints what it returned", async ({
    ayme,
    baseURL,
  }) => {
    const opened = await ayme("open", `${baseURL}/dialogs.html`);
    const { page, dialogs } = await automation(opened.stdout);

    expect(await ayme("call", "DialogPage.removeAcceptingThenMark")).toEqual({
      code: 0,
      stdout: expect.stringMatching(/^settled: true\nresult: "accepted"\n/),
      stderr: "",
    });
    expect(dialogs).toHaveLength(1);
    expect(await page.locator("#marks").textContent()).toBe("1");
  });
});

test("a dialog on one Tab leaves a command on another Tab alone, and a command naming its Tab is answered at once that it is open", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { context, page, dialogs } = await automation(opened.stdout);
  // The Session watches the Tab's dialogs from its first read of the Tab.
  await ayme("page-objects");
  // A click of the automation's own would wait for the confirm's answer.
  await page.evaluate(() =>
    setTimeout(() => document.getElementById("remove")!.click())
  );
  await expect.poll(() => dialogs.length).toBe(1);
  const shop = await context.newPage();
  await shop.goto(`${baseURL}/shop.html`);

  expect(await ayme("call", "ShopPage.readHeading")).toEqual({
    code: 0,
    stdout: 'settled: true\nresult: "Shop"\n',
    stderr: "",
  });
  expect((await ayme("tools")).stdout).toMatch(/^Tab: Shop \(/);
  const onDialogTab = `--tab=${baseURL}/dialogs.html`;
  expect(await ayme("tools", onDialogTab)).toEqual({
    code: 1,
    stdout: "",
    stderr: `Tab: ${baseURL}/dialogs.html\n${DIALOG_OPEN}\n`,
  });
  expect(await ayme("call", "DialogPage.removeThenMark", onDialogTab)).toEqual({
    code: 1,
    stdout: "",
    stderr: `${AT_RUN}\n`,
  });

  await dialogs[0]!.dismiss();

  expect(await ayme("tools", onDialogTab)).toMatchObject({ code: 0 });
  expect(await page.locator("#answer").textContent()).toBe("dismissed");
  expect(await page.locator("#marks").textContent()).toBe("0");
});
