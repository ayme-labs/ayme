import { describe, expect, it } from "vitest";

import { startScriptedSession, windowOn } from "../testing";
import type { InspectorEvent } from "./session/domain";

// The Inspector on a Session, through the Session's interface on the
// scripted browser: what `ayme inspect` and the Inspector window ask, and
// what the window is told.

/** Where the scripted Session's process serves its Inspector window. */
const WINDOW = "http://127.0.0.1:4444/inspector";

const opening = { open: { headed: false }, inspector: WINDOW } as const;

/** Whether `promise` is still pending once everything ready to run ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

/** A call of the window on the contract of the Tab it shows as `tab`. */
const contract = (method: string, params: unknown, tab: number) => ({
  inspector: {
    contract: {
      method,
      ...(params === undefined ? {} : { params }),
      tab,
    },
  },
});

/** The Tab the window that heard `heard` was told last. */
const shownTab = (heard: readonly InspectorEvent[]) =>
  heard.findLast((event) => "tab" in event) as
    { tab: number; noTab?: true } | undefined;

it("ayme inspect is answered with the address of the Session's Inspector window, with a code made for each opening", async () => {
  let made = 0;
  const { session } = await startScriptedSession({
    ...opening,
    name: "shop",
    opening: () => `${WINDOW}#code=${++made}`,
  });

  expect(await session.ask({ inspector: { window: {} } })).toEqual({
    ok: true,
    text: `The Inspector of the Session shop is at ${WINDOW}#code=1. The address opens one window, within 5 minutes.`,
    data: { address: `${WINDOW}#code=1` },
  });
  expect(await session.ask({ inspector: { window: {} } })).toMatchObject({
    data: { address: `${WINDOW}#code=2` },
  });
});

it("a window's call on the contract is answered by the Host of the Tab it shows, the most recently active, and follows the browser automation to another", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerInspector(async (method) => ({ from: "first", method }));
  const window = await windowOn(session);

  expect(await window.ask("getState")).toEqual({
    ok: true,
    text: "",
    data: { from: "first", method: "getState" },
  });
  const second = browser.openTab("http://127.0.0.1:5173/other");
  second.answerInspector(async (method, params) => ({
    from: "second",
    params,
  }));
  await expect.poll(() => window.tab()).toBe(2);

  expect(await window.ask("look", { deep: true })).toMatchObject({
    data: { from: "second", params: { deep: true } },
  });
  expect(second.hosted).toBe(true);
});

it("a Tab that shows the Inspector window is never the one the Session works on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show({
    tab: { url: "http://127.0.0.1:5173/shop", title: "Shop" },
    pageObjectTree: "ShopPage",
    tools: [],
  });
  // The person's default browser was the Session's own.
  const windowTab = browser.openTab(`${WINDOW}?a=1`);
  const window = await windowOn(session);

  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    ok: true,
    text: expect.stringMatching(
      /^Tab: Shop \(http:\/\/127\.0\.0\.1:5173\/shop\)/
    ),
  });
  expect(await window.ask("getState")).toMatchObject({ ok: true });
  expect(
    await session.ask({ pageObjects: { tab: `${WINDOW}?a=1` } })
  ).toMatchObject({
    ok: false,
  });
  expect(windowTab.hosted).toBe(false);
  expect(windowTab.inspectorCalls).toEqual([]);
});

it("a window's call when no tab is open is answered that no tab is open", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.close();
  const window = await windowOn(session);

  expect(await window.ask("getState")).toEqual({
    ok: false,
    text: "No tab is open in the Session's browser. Open one with your browser automation, then run ayme again.",
  });
});

it("a Run from the window waits for the Run under way on its Tab, and a command's Run waits for the window's", async () => {
  const { session, browser } = await startScriptedSession(opening);
  let releaseCommand = () => {};
  browser.answerRuns(
    () =>
      new Promise(
        (resolve) => (releaseCommand = () => resolve({ settled: true }))
      )
  );
  const window = await windowOn(session);
  const command = session.ask({ call: { tool: "Basket.add", input: {} } });
  await pending(command);

  const fromWindow = window.ask("runTool", {
    name: "Basket.clear",
    input: {},
    by: "inspector",
  });

  expect(await pending(fromWindow)).toBe(true);
  expect(browser.inspectorCalls).toEqual([]);
  let releaseWindow = () => {};
  browser.answerInspector(
    (method) =>
      new Promise((resolve) => (releaseWindow = () => resolve({ ran: method })))
  );
  releaseCommand();
  expect(await command).toMatchObject({ ok: true });
  await pending(fromWindow);
  expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
    "runTool",
  ]);

  const next = session.ask({ call: { tool: "Basket.add", input: {} } });
  expect(await pending(next)).toBe(true);
  expect(browser.runs).toHaveLength(1);
  releaseWindow();

  expect(await fromWindow).toEqual({
    ok: true,
    text: "",
    data: { ran: "runTool" },
  });
  await pending(next);
  releaseCommand();
  expect(await next).toMatchObject({ ok: true });
  expect(browser.runs).toHaveLength(2);
});

it("a window's reads take no turn: they are answered while a Run is under way", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = await windowOn(session);
  browser.answerRuns(() => new Promise(() => {}));
  void session.ask({ call: { tool: "Basket.hold", input: {} } });
  await pending(session.ask({ tools: {} }));

  expect(await window.ask("look")).toMatchObject({ ok: true });
  expect(
    await window.ask("highlight", { layer: "hover", refs: ["e1"] })
  ).toMatchObject({
    ok: true,
  });
});

it("a window's call the contract fails is answered with why", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerInspector(() =>
    Promise.reject(new Error('The Inspector contract has no "nope".'))
  );
  const window = await windowOn(session);

  expect(await window.ask("nope")).toEqual({
    ok: false,
    text: 'The Inspector contract has no "nope".',
  });
});

it("a window hears the contract's events of the Tab the Session works on, and is told when the Session works on another Tab", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  browser.tellInspector({ revision: 1 });
  const second = browser.openTab("http://127.0.0.1:5173/other");
  await expect.poll(() => second.inspectorListeners).toBe(1);
  browser.tellInspector({ revision: 2 });
  second.tellInspector({ revision: 1, tab: "second" });

  await expect
    .poll(() => window.heard)
    .toEqual([
      { tab: 1 },
      { contract: { revision: 1 } },
      { tab: 2 },
      { contract: { revision: 1, tab: "second" } },
    ]);
  expect(browser.inspectorListeners).toBe(0);
});

/** A Run of `name` from the window, on the Tab it shows as `tab`. */
const runFromWindow = (tab: number, name: string, input: unknown = {}) =>
  contract("runTool", { name, input, by: "inspector" }, tab);

it("a window's call is made on the Tab the window shows, even when the browser automation brought another to the front before the Session read its tab list", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });
  const release = browser.holdTabList();
  const second = browser.openTab("http://127.0.0.1:5173/other");

  expect(await session.ask(runFromWindow(1, "Basket.add"))).toMatchObject({
    ok: true,
  });

  expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
    "runTool",
  ]);
  expect(second.inspectorCalls).toEqual([]);
  release();
});

it("a window's call that names a Tab the Session no longer shows is refused before any work on the page", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });
  // The window opened a tool's form; the browser automation brings another
  // Tab forward before the developer presses Run.
  const second = browser.openTab("http://127.0.0.1:5173/other");
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 2 });

  expect(await session.ask(runFromWindow(1, "Basket.add"))).toEqual({
    ok: false,
    text: "The Inspector shows another Tab now, so ayme did not carry out this call on the Tab the window showed.",
  });
  expect(await session.ask(contract("look", undefined, 1))).toMatchObject({
    ok: false,
  });

  expect(browser.inspectorCalls).toEqual([]);
  expect(second.inspectorCalls).toEqual([]);
  expect(await session.ask(contract("look", undefined, 2))).toMatchObject({
    ok: true,
    data: "look",
  });
});

it("a window's Run that started finishes on its own Tab when the Session shows another", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });
  let finish = () => {};
  browser.answerInspector(
    () => new Promise((resolve) => (finish = () => resolve("first's Run")))
  );
  const run = session.ask(runFromWindow(1, "Basket.add"));
  await expect.poll(() => browser.inspectorCalls).toHaveLength(1);

  const second = browser.openTab("http://127.0.0.1:5173/other");
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 2 });
  finish();

  expect(await run).toEqual({ ok: true, text: "", data: "first's Run" });
  expect(second.inspectorCalls).toEqual([]);
});

it("a window's Run of a tool whose Page Object Id is of another Tab is refused", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const second = browser.openTab("http://127.0.0.1:5173/other");
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
  second.give("po9", "Basket");
  second.activate();
  browser.activate();
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });

  expect(
    await session.ask(runFromWindow(1, "Basket.add", { id: "po9" }))
  ).toEqual({
    ok: false,
    text: "po9 is a Page Object of the tab that shows http://127.0.0.1:5173/other, not of the Tab the Inspector shows.",
  });
  expect(browser.inspectorCalls).toEqual([]);
  expect(second.inspectorCalls).toEqual([]);
});

it("a window that shows a Tab is told it shows no Tab once the last Tab closed, then the next Tab that opens, as a new Tab", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });

  browser.close();

  await expect
    .poll(() => shownTab(window.heard))
    .toEqual({ tab: 2, noTab: true });

  browser.openTab("http://127.0.0.1:5173/shop");

  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 3 });
});

it("a window that listens while no tab is open is told the first Tab that opens, as a new Tab", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.close();
  const window = session.listen();
  await expect
    .poll(() => shownTab(window.heard))
    .toEqual({ tab: 1, noTab: true });
  expect(await session.ask(contract("getState", undefined, 1))).toEqual({
    ok: false,
    text: "No tab is open in the Session's browser. Open one with your browser automation, then run ayme again.",
  });

  const first = browser.openTab("http://127.0.0.1:5173/shop");

  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 2 });
  expect(first.inspectorListeners).toBe(1);
  expect(await session.ask(contract("getState", undefined, 2))).toMatchObject({
    ok: true,
    data: "getState",
  });
});

it("a window that listens while the tab list cannot be read is told so, and then the Tab, as a new Tab, once it can", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const readable = browser.failTabList(
    "ayme could not read the browser's tab list."
  );
  const window = session.listen();
  await expect
    .poll(() => shownTab(window.heard))
    .toEqual({ tab: 1, noTab: true });

  readable();

  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 2 });
  // The Session tells the Tab first and subscribes to its Host right after.
  await expect.poll(() => browser.inspectorListeners).toBe(1);
});

it("one reading of the tab list and one subscription to the Tab's Host serve every window, and stop with the last one", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const first = session.listen();
  const second = session.listen();
  await expect.poll(() => shownTab(second.heard)).toEqual({ tab: 1 });
  expect(shownTab(first.heard)).toEqual({ tab: 1 });
  expect(browser.inspectorListeners).toBe(1);
  const reads = browser.tabListReads;
  await new Promise((resolve) => setTimeout(resolve, 600));
  // One reading every 250 ms, whichever number of windows listens.
  expect(browser.tabListReads - reads).toBeLessThanOrEqual(3);

  browser.tellInspector({ revision: 1 });
  await first.stop();
  browser.tellInspector({ revision: 2 });

  await expect
    .poll(() => second.heard.filter((event) => "contract" in event))
    .toEqual([{ contract: { revision: 1 } }, { contract: { revision: 2 } }]);
  expect(browser.inspectorListeners).toBe(1);
  await second.stop();
  expect(browser.inspectorListeners).toBe(0);
  const stopped = browser.tabListReads;
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(browser.tabListReads).toBe(stopped);
});

it("a failed or late reading of the tab list keeps the Tab the windows show, and its subscription", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => shownTab(window.heard)).toEqual({ tab: 1 });

  const readable = browser.failTabList(
    "ayme could not read the browser's tab list."
  );
  const failing = browser.tabListReads;
  await expect.poll(() => browser.tabListReads).toBeGreaterThan(failing + 1);
  readable();
  const release = browser.holdTabList();
  const holding = browser.tabListReads;
  await expect.poll(() => browser.tabListReads).toBe(holding + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));

  expect(window.heard).toEqual([{ tab: 1 }]);
  expect(browser.inspectorListeners).toBe(1);
  expect(await session.ask(contract("look", undefined, 1))).toMatchObject({
    ok: true,
  });
  release();
});

it("a window that stops listening ends the Session's subscription to the Tab's contract, and the Session goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  await window.stop();

  expect(browser.inspectorListeners).toBe(0);
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
});

it("when the Session ends, each window is told why, and how to get it back in a window and in an Agent App's chat, with the Session's name in every command; nothing follows", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    name: "shop",
  });
  const window = session.listen();
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  await session.ask({ stop: {} });

  await window.done;
  expect(window.heard).toEqual([
    { tab: 1 },
    {
      ended:
        "The Session shop was closed. Start a Session with ayme -s=shop open or ayme -s=shop attach, then run ayme -s=shop inspect to inspect it.",
      inChat:
        "The Session shop was closed. Start a Session with ayme -s=shop open or ayme -s=shop attach, then ask your agent to show the Inspector again.",
    },
  ]);
  expect(browser.inspectorListeners).toBe(0);
});

it("a window is told the Session ended when its browser goes away, and one that listens later is told at once", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const window = session.listen();

  browser.goAway();

  await window.done;
  expect(window.heard).toEqual([
    {
      ended: expect.stringMatching(
        /^The Session default ended: its browser went away\./
      ),
      inChat: expect.stringMatching(
        /^The Session default ended: its browser went away\. .* then ask your agent to show the Inspector again\.$/
      ),
    },
  ]);
  const late = session.listen();
  await late.done;
  expect(late.heard).toEqual(window.heard);
});

it("a window's Run still waiting when the Session ends is answered that the Session was closed", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerInspector(() => new Promise(() => {}));
  const window = await windowOn(session);
  const fromWindow = window.ask("runTool", {
    name: "Basket.hold",
    input: {},
    by: "inspector",
  });
  await pending(fromWindow);

  await session.ask({ stop: {} });

  expect(await fromWindow).toEqual({
    ok: false,
    text: "The Session was closed before it answered this command.",
  });
});

it("a window's Run and read on a Tab that closes are answered that the tab was closed, and the window follows the Tab the Session works on next", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const other = browser.openTab("http://127.0.0.1:5173/other");
  other.answerInspector(() => new Promise(() => {}));
  const window = await windowOn(session);
  await expect.poll(() => other.inspectorListeners).toBe(1);
  const run = window.ask("runTool", {
    name: "Basket.hold",
    input: {},
    by: "inspector",
  });
  const read = window.ask("look");
  expect(await pending(run)).toBe(true);
  expect(await pending(read)).toBe(true);

  other.close();

  const closed = {
    ok: false,
    text: "The tab was closed before ayme answered this command.",
  };
  expect(await run).toEqual(closed);
  expect(await read).toEqual(closed);
  expect(other.inspectorListeners).toBe(0);
  await expect.poll(() => browser.inspectorListeners).toBe(1);
  expect(window.heard).toEqual([{ tab: 1 }, { tab: 2 }]);
  // The closed Tab's Run gave back the turn.
  expect(
    await session.ask({ call: { tool: "Basket.add", input: {} } })
  ).toMatchObject({
    ok: true,
  });
});

describe("once a joined Session begins to end, which leaves its browser open", () => {
  const joining = {
    join: { cdp: "http://127.0.0.1:9222" },
    inspector: WINDOW,
  } as const;
  const detached = {
    ok: false,
    text: "ayme detach ended the Session before it answered this command.",
  };

  it("a window's call is refused before it reads the page", async () => {
    const { session, browser } = await startScriptedSession(joining);
    const window = await windowOn(session);
    expect(await window.ask("look")).toMatchObject({ ok: true });

    await session.ask({ detach: {} });

    expect(await window.ask("look")).toEqual(detached);
    expect(await session.ask(runFromWindow(1, "Basket.add"))).toEqual(detached);
    expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
      "look",
    ]);
  });

  it("a window's Run waiting behind another never starts", async () => {
    const { session, browser } = await startScriptedSession(joining);
    let finish = () => {};
    browser.answerInspector(
      () => new Promise((resolve) => (finish = () => resolve("done")))
    );
    const window = await windowOn(session);
    const first = window.ask("runTool", { name: "Basket.add", input: {} });
    await expect.poll(() => browser.inspectorCalls).toHaveLength(1);
    const second = window.ask("runTool", { name: "Basket.clear", input: {} });
    expect(await pending(second)).toBe(true);

    await session.ask({ detach: {} });
    finish();

    expect(await first).toEqual(detached);
    expect(await second).toEqual(detached);
    await new Promise((resolve) => setImmediate(resolve));
    expect(browser.inspectorCalls).toHaveLength(1);
  });
});

it("a Session served without a window says so to ayme inspect", async () => {
  const { session } = await startScriptedSession({ open: { headed: false } });

  expect(await session.ask({ inspector: { window: {} } })).toEqual({
    ok: false,
    text: "This Session serves no Inspector window.",
  });
});
