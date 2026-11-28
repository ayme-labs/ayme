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

const DIALOG =
  'A confirm dialog is open on the tab: "Remove Milk from the basket?".';
const DIALOG_OPEN = `${DIALOG} Answer it with your browser automation, then run this command again.`;
const AT_RUN = `${DIALOG} Answer it with your browser automation. The action stopped there: ayme refuses its further calls on the page, however the dialog is answered. Check the page before you choose the next step.`;

for (const [answer, answered] of [
  ["accept", "accepted"],
  ["dismiss", "dismissed"],
] as const)
  test(`an action that clicks, gets a confirm and has a second click after it ends at the confirm: ayme call says a dialog is open, and once the automation answers it with ${answer}, the second click never comes`, async ({
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
    // The automation hears the dialog on a connection of its own.
    await expect
      .poll(() => dialogs.map((dialog) => dialog.message()))
      .toEqual(["Remove Milk from the basket?"]);
    expect(await ayme("tools")).toEqual({
      code: 1,
      stdout: "",
      stderr: `Tab t1: ${baseURL}/dialogs.html\n${DIALOG_OPEN}\n`,
    });

    await dialogs[0]![answer]();

    // ayme hears the dialog close on a connection of its own; the listing
    // waits for the stopped action to end, and tells nothing of it.
    await expect
      .poll(async () => (await ayme("page-objects")).stdout)
      .toMatch(/^Tab t1: Dialogs \(/);
    const listing = await ayme("page-objects");
    expect(listing).toMatchObject({ code: 0, stderr: "" });
    expect(listing.stdout).not.toMatch(/dialog is open|stop/i);
    expect(await page.locator("#answer").textContent()).toBe(answered);
    expect(await page.locator("#marks").textContent()).toBe("0");
  });

test("a dialog on one Tab leaves a command on another Tab alone, and a command naming its Tab is answered at once that it is open", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { context, page, dialogs } = await automation(opened.stdout);
  // The first Tab ayme hosts in a browser context makes Playwright set up
  // its bindings on every page of it, which waits while any of them shows a
  // dialog: hosting this Tab first keeps that wait out of this test.
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
  expect((await ayme("tools")).stdout).toMatch(/^Tab t2: Shop \(/);
  const onDialogTab = `--tab=${baseURL}/dialogs.html`;
  expect(await ayme("tools", onDialogTab)).toEqual({
    code: 1,
    stdout: "",
    stderr: `Tab t1: ${baseURL}/dialogs.html\n${DIALOG_OPEN}\n`,
  });
  expect(await ayme("call", "DialogPage.removeThenMark", onDialogTab)).toEqual({
    code: 1,
    stdout: "",
    stderr: `${DIALOG_OPEN}\n`,
  });

  await dialogs[0]!.dismiss();

  // ayme hears the dialog close on a connection of its own.
  await expect
    .poll(async () => (await ayme("tools", onDialogTab)).code)
    .toBe(0);
  expect(await page.locator("#answer").textContent()).toBe("dismissed");
  expect(await page.locator("#marks").textContent()).toBe("0");
});

test("a dialog open before ayme worked on any Tab of its browser context holds a command on another Tab only for ayme's setup limit, which names the dialog, and the command works once it is answered", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { context, page, dialogs } = await automation(opened.stdout);
  const shop = await context.newPage();
  await shop.goto(`${baseURL}/shop.html`);
  // A click of the automation's own would wait for the confirm's answer.
  await page.evaluate(() =>
    setTimeout(() => document.getElementById("remove")!.click())
  );
  await expect.poll(() => dialogs.length).toBe(1);

  expect(await ayme("call", "ShopPage.readHeading")).toEqual({
    code: 1,
    stdout: "",
    stderr: `ayme's setup of this command's tab did not answer in time, so the command did nothing. A confirm dialog is open on another tab, at ${baseURL}/dialogs.html: "Remove Milk from the basket?". A dialog on another tab can hold that setup. Answer it with your browser automation, then run this command again.\n`,
  });

  await dialogs[0]!.dismiss();

  expect(await ayme("call", "ShopPage.readHeading")).toEqual({
    code: 0,
    stdout: 'settled: true\nresult: "Shop"\n',
    stderr: "",
  });
  expect((await ayme("page-objects", `--tab=${baseURL}/shop.html`)).code).toBe(
    0
  );
  // ayme hears the dialog close on a connection of its own.
  await expect
    .poll(
      async () => (await ayme("tools", `--tab=${baseURL}/dialogs.html`)).code
    )
    .toBe(0);
  expect(await page.locator("#answer").textContent()).toBe("dismissed");
});

test("a Tab closed while a dialog on another Tab holds its setup leaves the browser's other Tabs to work once the dialog is answered", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { context, page, dialogs } = await automation(opened.stdout);
  const shop = await context.newPage();
  await shop.goto(`${baseURL}/shop.html`);
  const account = await context.newPage();
  await account.goto(`${baseURL}/account.html`);
  await page.evaluate(() =>
    setTimeout(() => document.getElementById("remove")!.click())
  );
  await expect.poll(() => dialogs.length).toBe(1);

  const held = ayme(
    "call",
    "ShopPage.readHeading",
    `--tab=${baseURL}/shop.html`
  );
  // Long enough for the command to reach its Tab's setup, which then waits
  // behind the confirm; nothing the test can observe says it has.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await shop.close();
  expect((await held).code).toBe(1);

  await dialogs[0]!.dismiss();

  // A setup left waiting on the closed Tab would fail each try after 5
  // seconds, so no try would pass in time.
  await expect
    .poll(
      async () =>
        (await ayme("page-objects", `--tab=${baseURL}/account.html`)).code,
      { timeout: 12_000 }
    )
    .toBe(0);
});

test("a dialog the page opened before any command touched its Tab is answered at once", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { page, dialogs } = await automation(opened.stdout);
  // A click of the automation's own would wait for the confirm's answer.
  await page.evaluate(() =>
    setTimeout(() => document.getElementById("remove")!.click())
  );
  await expect.poll(() => dialogs.length).toBe(1);

  expect(await ayme("tools")).toEqual({
    code: 1,
    stdout: "",
    stderr: `Tab t1: ${baseURL}/dialogs.html\n${DIALOG_OPEN}\n`,
  });

  await dialogs[0]!.dismiss();
  // ayme hears the dialog close on a connection of its own.
  await expect.poll(async () => (await ayme("tools")).code).toBe(0);
});

test("a popup that opens a dialog as it loads: a command on it is answered at once that the dialog is open", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/dialogs.html`);
  const { page, dialogs } = await automation(opened.stdout);

  await page.locator("#popup").click();
  await expect.poll(() => dialogs.length).toBe(1);

  expect(await ayme("tools")).toEqual({
    code: 1,
    stdout: "",
    stderr: expect.stringMatching(
      /^Tab t1: \S+\nAn alert dialog is open on the tab: "Saved"\. Answer it with your browser automation, then run this command again\.\n$/
    ),
  });

  await dialogs[0]!.accept();
  await expect
    .poll(async () => (await ayme("tools")).stdout)
    .toMatch(/^Tab t1: Alert \(/);
});
