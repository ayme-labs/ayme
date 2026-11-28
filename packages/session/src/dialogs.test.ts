import { expect, it } from "vitest";

import { RunError, type Dialog, type RunAnswer } from "./session/domain";
import { startScriptedSession, windowOn, type ScriptedTab } from "../testing";

// Dialogs on a Session's Tabs (rules 4 and 5), through the Session's
// interface on the scripted browser, which plays a dialog opening, its 100
// ms passing and its closing by hand: the orderings the Session's statechart
// model checked.

const opening = { open: { headed: false } } as const;

/** Whether `promise` is still pending once everything ready to run ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

const confirm = { type: "confirm", message: "Remove Milk from the basket?" };

const DIALOG =
  'A confirm dialog is open on the tab: "Remove Milk from the basket?".';
const DIALOG_OPEN = `${DIALOG} Answer it with your browser automation, then run this command again.`;
const AT_RUN = `${DIALOG} Answer it with your browser automation. The action stopped there: ayme refuses its further calls on the page, however the dialog is answered. Check the page before you choose the next step.`;

const shop = {
  tab: { url: "http://127.0.0.1:5173/shop.html", title: "Shop" },
  pageObjectTree: "ShopPage",
  tools: [],
};

const remove = { call: { tool: "Basket.remove", input: { id: "po1" } } };
const readHeading = { call: { tool: "ShopPage.readHeading", input: {} } };

/** Where the scripted Session's process serves its Inspector window. */
const WINDOW = "http://127.0.0.1:4444/inspector";

/** Each Run on `tab` waits until the test ends its action with the function
 * the returned `end` holds: with what it returned, or with what it threw. */
function holdRuns(tab: ScriptedTab) {
  const ends: ((outcome: RunAnswer | RunError) => void)[] = [];
  tab.answerRuns(
    () =>
      new Promise((resolve, reject) =>
        ends.push((outcome) =>
          outcome instanceof RunError ? reject(outcome) : resolve(outcome)
        )
      )
  );
  return { end: (outcome: RunAnswer | RunError) => ends.shift()!(outcome) };
}

/** A dialog opens on `tab` and stays open for 100 ms. */
function dialogOpens(tab: ScriptedTab, dialog: Dialog = confirm) {
  tab.openDialog(dialog);
  tab.dialogStaysOpen();
}

it("a dialog open for 100 ms during a Run ends the Run: its command is answered that a dialog is open, with the dialog's text", async () => {
  const { session, browser } = await startScriptedSession(opening);
  holdRuns(browser);
  const call = session.ask(remove);
  expect(await pending(call)).toBe(true);

  browser.openDialog(confirm);
  expect(await pending(call)).toBe(true);
  browser.dialogStaysOpen();

  expect(await call).toEqual({ ok: false, text: AT_RUN });
});

it("the stopped action keeps the Tab's turn: the next Run starts only once it has ended, and no later command tells of it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await pending(call);
  dialogOpens(browser);
  expect(await call).toMatchObject({ ok: false });

  browser.closeDialog();
  const next = session.ask(readHeading);
  expect(await pending(next)).toBe(true);
  expect(browser.runs).toEqual([remove.call]);

  // As the stopped action fails at its next Playwright call, which ayme
  // refuses.
  runs.end(new RunError("RunStoppedError: the Run stopped at a dialog."));
  expect(await pending(next)).toBe(true);
  expect(browser.runs).toEqual([remove.call, readHeading.call]);
  runs.end({ settled: true, result: "Shop" });

  expect(await next).toEqual({
    ok: true,
    text: 'settled: true\nresult: "Shop"',
    data: { settled: true, result: "Shop" },
  });
  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: "Tab t1: Shop (http://127.0.0.1:5173/shop.html)\nThis screen has no Page Object Tools.",
    data: { tab: { id: "t1", ...shop.tab }, tools: [] },
  });
});

it("while a dialog is open, every command that needs the page is answered at once, a listing after its Tab line, and no Run starts", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });

  dialogOpens(browser);

  const inListing = {
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  };
  expect(await session.ask({ pageObjects: {} })).toEqual(inListing);
  expect(await session.ask({ tools: {} })).toEqual(inListing);
  expect(await session.ask(readHeading)).toEqual({
    ok: false,
    text: DIALOG_OPEN,
  });
  expect(browser.runs).toEqual([]);

  browser.closeDialog();
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
});

it("a prompt's answer gives its default value, and an alert is named with its article", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });

  dialogOpens(browser, {
    type: "prompt",
    message: "Name the list",
    defaultValue: "Groceries",
  });
  expect(await session.ask(readHeading)).toMatchObject({
    text: expect.stringMatching(
      /^A prompt dialog is open on the tab: "Name the list"\. Its default value is "Groceries"\. Answer it/
    ),
  });

  browser.closeDialog();
  dialogOpens(browser, { type: "alert", message: "Saved" });
  expect(await session.ask(readHeading)).toMatchObject({
    text: expect.stringMatching(/^An alert dialog is open on the tab: "Saved"/),
  });
});

it("a dialog that closes within 100 ms changes nothing: the Run under way goes on and answers what its action returned", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await pending(call);

  // As an action that answers its own dialog, or an automation that
  // accepts an alert by itself.
  browser.openDialog(confirm);
  browser.closeDialog();
  runs.end({ settled: true, result: true });

  expect(await call).toEqual({
    ok: true,
    text: "settled: true\nresult: true",
    data: { settled: true, result: true },
  });
});

it("a command that arrives while a dialog opens waits for the 100 ms: it is answered that the dialog is open once it counts, and as usual when it closes before", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });

  browser.openDialog(confirm);
  const early = session.ask({ tools: {} });
  expect(await pending(early)).toBe(true);
  browser.dialogStaysOpen();
  expect(await early).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });

  browser.closeDialog();
  browser.openDialog(confirm);
  const passing = session.ask(readHeading);
  expect(await pending(passing)).toBe(true);
  expect(browser.runs).toEqual([]);
  browser.closeDialog();
  expect(await passing).toMatchObject({ ok: true });
  expect(browser.runs).toEqual([readHeading.call]);
});

it("commands waiting for the Tab's turn when a dialog counts are answered at once, and never start, also once the stopped action has ended", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: WINDOW,
  });
  const window = await windowOn(session);
  const runs = holdRuns(browser);
  const first = session.ask(remove);
  await pending(first);
  const waiting = session.ask(readHeading);
  const listing = session.ask({ pageObjects: {} });
  const fromWindow = window.ask("runTool", {
    name: "Basket.clear",
    input: {},
    by: "inspector",
  });
  expect(await pending(waiting)).toBe(true);

  dialogOpens(browser);

  expect(await first).toEqual({ ok: false, text: AT_RUN });
  expect(await waiting).toEqual({ ok: false, text: DIALOG_OPEN });
  expect(await listing).toEqual({
    ok: false,
    text: `Tab t1: about:blank\n${DIALOG_OPEN}`,
  });
  expect(await fromWindow).toEqual({ ok: false, text: DIALOG_OPEN });

  browser.closeDialog();
  browser.answerRuns(() => Promise.resolve({ settled: true }));
  runs.end(new RunError("RunStoppedError: the Run stopped at a dialog."));
  expect(await session.ask(readHeading)).toMatchObject({ ok: true });

  expect(browser.runs).toEqual([remove.call, readHeading.call]);
  expect(browser.listingsRead).toBe(0);
  expect(browser.inspectorCalls).toEqual([]);
});

it("a listing under way when a dialog opens outside a Run is answered that the dialog is open once it counts", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  // As a read the dialog holds.
  browser.holdReads();
  const listing = session.ask({ pageObjects: {} });
  expect(await pending(listing)).toBe(true);

  dialogOpens(browser);

  expect(await listing).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
});

it("a dialog affects only its own Tab: commands on another Tab are answered as usual, and a Run there goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  const other = browser.openTab("http://127.0.0.1:5173/sign-in.html");
  const otherRuns = holdRuns(other);
  const elsewhere = session.ask(readHeading);
  await pending(elsewhere);

  dialogOpens(browser);

  otherRuns.end({ settled: true });
  expect(await elsewhere).toEqual({
    ok: true,
    text: "settled: true",
    data: { settled: true },
  });
  expect(await session.ask({ tools: {} })).toMatchObject({
    ok: true,
    text: expect.stringMatching(/^Tab t2: http:\/\/127\.0\.0\.1:5173\/sign-in/),
  });
  expect(await session.ask({ tools: { tab: shop.tab.url } })).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
});

it("ayme close while a stopped action holds the Tab's turn ends the Session at once, and answers the command waiting for that turn", async () => {
  const { session, browser } = await startScriptedSession(opening);
  holdRuns(browser);
  const call = session.ask(remove);
  await pending(call);
  dialogOpens(browser);
  await call;
  browser.closeDialog();
  const next = session.ask(readHeading);
  expect(await pending(next)).toBe(true);

  expect(await session.ask({ stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  expect(await next).toEqual({
    ok: false,
    text: "The Session was closed before it answered this command.",
  });
  expect(browser.runs).toEqual([remove.call]);
});

it("a Run from the Inspector window ends at a dialog with the same sentence, and a window's read while one is open is answered at once", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: WINDOW,
  });
  browser.answerInspector(() => new Promise(() => {}));
  const window = await windowOn(session);
  const fromWindow = window.ask("runTool", {
    name: "Basket.clear",
    input: {},
    by: "inspector",
  });
  expect(await pending(fromWindow)).toBe(true);

  dialogOpens(browser);

  expect(await fromWindow).toEqual({ ok: false, text: AT_RUN });
  expect(await window.ask("look")).toEqual({
    ok: false,
    text: DIALOG_OPEN,
  });
  expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
    "runTool",
  ]);
  expect(await session.ask({ inspector: { window: {} } })).toMatchObject({
    ok: true,
  });
});

it("a listing a dialog answered lets go of the Tab's turn, so the next Swap waits for no read the dialog holds", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  browser.holdReads();
  const listing = session.ask({ pageObjects: {} });
  expect(await pending(listing)).toBe(true);

  dialogOpens(browser);
  expect(await listing).toMatchObject({ ok: false });
  browser.closeDialog();
  const edited = { built: "after the edit" };
  await browser.edit();
  await browser.until(() => browser.builds === 2);
  browser.finishBuild(edited);

  await browser.until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([edited]);
});

it("a dialog already open on a Tab no command touched yet is answered at once, and the Session does not host the Tab", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);

  dialogOpens(browser);

  expect(await session.ask({ tools: {} })).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
  expect(await session.ask(readHeading)).toEqual({
    ok: false,
    text: DIALOG_OPEN,
  });
  expect(browser.hosted).toBe(false);
  expect(browser.runs).toEqual([]);

  browser.closeDialog();
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
  expect(browser.hosted).toBe(true);
});

it("a Tab no command touched yet whose dialog is opening is hosted only once the dialog closes: one that counts answers the command, and the Tab stays unhosted", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);

  browser.openDialog(confirm);
  const counted = session.ask({ tools: {} });
  expect(await pending(counted)).toBe(true);
  expect(browser.hosted).toBe(false);
  browser.dialogStaysOpen();
  expect(await counted).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
  expect(browser.hosted).toBe(false);

  browser.closeDialog();
  browser.openDialog(confirm);
  const passing = session.ask({ tools: {} });
  expect(await pending(passing)).toBe(true);
  expect(browser.hosted).toBe(false);
  browser.closeDialog();
  expect(await passing).toMatchObject({ ok: true });
  expect(browser.hosted).toBe(true);
});

it("a dialog that counts while its Tab is being hosted answers the command waiting for it, and the Tab is hosted only once the dialog is answered", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  const release = browser.holdHosting();
  const read = session.ask({ tools: {} });
  expect(await pending(read)).toBe(true);

  dialogOpens(browser);

  expect(await read).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
  expect(browser.hosted).toBe(false);
  release();
  browser.closeDialog();
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
  expect(browser.hosted).toBe(true);
});

it("a Tab that closes while a command waits for its dialog to count is answered that it closed, hosted or not", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const other = browser.openTab("http://127.0.0.1:5173/sign-in.html");
  await session.ask({ tools: {} });
  other.openDialog(confirm);
  browser.openDialog(confirm);
  const onHosted = session.ask({ tools: {} });
  const onUnhosted = session.ask({ tools: { tab: "about:blank" } });
  expect(await pending(onHosted)).toBe(true);
  expect(await pending(onUnhosted)).toBe(true);

  other.close();
  browser.close();

  const closed = {
    ok: false,
    text: "The tab was closed before ayme answered this command.",
  };
  expect(await onHosted).toEqual(closed);
  expect(await onUnhosted).toEqual(closed);
});

it("while a dialog is open, a window's requests that need no page are answered as usual: its first state, the recorded page state and a definition", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: WINDOW,
  });
  await session.ask({ tools: {} });
  const window = await windowOn(session);
  dialogOpens(browser);

  for (const method of ["getState", "recordedPageState", "pomDefinitionText"])
    expect(await window.ask(method)).toMatchObject({ ok: true });
  expect(await window.ask("look")).toEqual({
    ok: false,
    text: DIALOG_OPEN,
  });
  expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
    "getState",
    "recordedPageState",
    "pomDefinitionText",
  ]);
});

it("a window's read under way when a dialog counts is answered that the dialog is open", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: WINDOW,
  });
  await session.ask({ tools: {} });
  const window = await windowOn(session);
  browser.answerInspector(() => new Promise(() => {}));
  const read = window.ask("look");
  expect(await pending(read)).toBe(true);

  dialogOpens(browser);

  expect(await read).toEqual({ ok: false, text: DIALOG_OPEN });
});

it("a Tab that closes while a stopped action holds its turn answers the command waiting for that turn that it closed", async () => {
  const { session, browser } = await startScriptedSession(opening);
  holdRuns(browser);
  const call = session.ask(remove);
  await pending(call);
  dialogOpens(browser);
  expect(await call).toEqual({ ok: false, text: AT_RUN });
  browser.closeDialog();
  const next = session.ask(readHeading);
  expect(await pending(next)).toBe(true);

  browser.close();

  expect(await next).toEqual({
    ok: false,
    text: "The tab was closed before ayme answered this command.",
  });
  expect(browser.runs).toEqual([remove.call]);
});

it("a dialog that opens while the Session starts answers its first command once the start is answered", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });
  browser.show(shop);
  dialogOpens(browser);
  const first = session.ask({ tools: {} });
  expect(await pending(first)).toBe(true);

  browser.open();

  expect(await session.started).toMatchObject({ ok: true });
  expect(await first).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${DIALOG_OPEN}`,
  });
});

const dialogsUrl = "http://127.0.0.1:5173/dialogs.html";

it("a Tab whose setup a dialog on another Tab holds is answered with that dialog, by its Tab's URL and its text, and starts nothing; once the dialog is answered, the same command and one on the dialog's Tab work", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show({ ...shop, tab: { url: dialogsUrl, title: "Dialogs" } });
  dialogOpens(browser);
  const other = browser.openTab(shop.tab.url);
  other.show(shop);
  const release = other.holdSetup({ url: dialogsUrl, dialog: confirm });
  const held = `ayme's setup of this command's tab did not answer in time, so the command did nothing. A confirm dialog is open on another tab, at ${dialogsUrl}: "Remove Milk from the basket?". A dialog on another tab can hold that setup. Answer it with your browser automation, then run this command again.`;

  expect(await session.ask(readHeading)).toEqual({ ok: false, text: held });
  expect(await session.ask({ tools: {} })).toEqual({ ok: false, text: held });
  expect(other.hosted).toBe(false);
  expect(other.runs).toEqual([]);

  browser.closeDialog();
  release();

  expect(await session.ask(readHeading)).toMatchObject({ ok: true });
  expect(other.runs).toEqual([{ tool: "ShopPage.readHeading", input: {} }]);
  expect(await session.ask({ tools: { tab: dialogsUrl } })).toMatchObject({
    ok: true,
    text: expect.stringMatching(/^Tab t2: Dialogs \(/),
  });
});

it("a Tab whose setup is held while the Session knows of no dialog on another Tab is answered that one may be open there", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  browser.holdSetup();

  expect(await session.ask(readHeading)).toEqual({
    ok: false,
    text: "ayme's setup of this command's tab did not answer in time, as happens while a dialog is open on another tab of the browser, so the command did nothing. If one is open, answer it with your browser automation, then run this command again.",
  });
  expect(browser.hosted).toBe(false);
});
