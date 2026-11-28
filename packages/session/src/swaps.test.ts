import { expect, it } from "vitest";

import { RunError, type RunAnswer } from "./session/domain";
import {
  SCRIPTED_PAGE_OBJECTS,
  startScriptedSession,
  type ScriptedBrowser,
  type ScriptedTab,
  windowOn,
} from "../testing";

// Rebuilds and Swaps (rule 7), through the Session's interface on the
// scripted browser, where the test edits the source and finishes or fails
// each build by hand: the orderings of builds, Runs and Swaps the Session's
// statechart model checked.

const opening = { open: { headed: false } } as const;

const EDITED = Object.freeze({ built: "after the edit" });

it("an edit makes the Session rebuild, and the rebuilt Page Objects are swapped in on its Tab with no command waiting", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });

  await browser.edit();
  await browser.until(() => browser.builds === 2);
  expect(browser.swappedIn).toEqual([]);
  browser.finishBuild(EDITED);

  await browser.until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([EDITED]);
});

const LATER = Object.freeze({ built: "after the second edit" });

const shop = {
  tab: { url: "http://127.0.0.1:5173/shop.html", title: "Shop" },
  pageObjectTree: "ShopPage",
  tools: [],
};

const remove = { call: { tool: "Basket.remove", input: { id: "po1" } } };
const readHeading = { call: { tool: "ShopPage.readHeading", input: {} } };

const confirm = { type: "confirm", message: "Remove Milk from the basket?" };

const BUILD_ERRORS =
  'The Page Objects of /app/ayme/page-objects.ts did not build:\n✘ [ERROR] Expected ";" but found "basket"\n\n    ayme/pom/Basket.ts:3:9:';
const FIRST_ERROR = 'ayme/pom/Basket.ts:3:9: Expected ";" but found "basket"';

const BUILD_LINE = `Page Object rebuild failed. Keeping the current Page Objects. ${FIRST_ERROR}`;

it("the build line names the first error whole on one line, a failure without one by the first line of its message, and one inside ayme as such", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.started;
  await browser.edit();
  await browser.until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, `${FIRST_ERROR} in {\n  more of it\n}`);
  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    `${BUILD_LINE} in { more of it }`
  );

  await browser.edit();
  await browser.until(() => browser.builds === 3);
  browser.failBuild("The Page Objects did not load: x is not defined\nat …");
  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    "Page Object rebuild failed. Keeping the current Page Objects. The Page Objects did not load: x is not defined"
  );

  await browser.edit();
  await browser.until(() => browser.builds === 4);
  browser.breakBuild(new Error("EACCES: permission denied, mkdtemp"));
  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    "Page Object rebuild failed. Keeping the current Page Objects. ayme broke while it rebuilt them: EACCES: permission denied, mkdtemp"
  );
});

/** Each Run on `tab` waits until the test ends it; `swapsSeen` holds how
 * many Swaps the Tab had when each Run started. */
function holdRuns(tab: ScriptedTab) {
  const ends: ((outcome: RunAnswer | RunError) => void)[] = [];
  const swapsSeen: number[] = [];
  tab.answerRuns(() => {
    swapsSeen.push(tab.swappedIn.length);
    return new Promise((resolve, reject) =>
      ends.push((outcome) =>
        outcome instanceof RunError ? reject(outcome) : resolve(outcome)
      )
    );
  });
  return {
    swapsSeen,
    end: (outcome: RunAnswer | RunError = { settled: true }) =>
      ends.shift()!(outcome),
  };
}

/** The developer edits the source, and the build it starts finishes as
 * `built`. */
async function rebuilt(browser: ScriptedBrowser, built: object) {
  const before = browser.builds;
  await browser.edit();
  await browser.until(() => browser.builds === before + 1);
  browser.finishBuild(built);
}

const SECOND_TAB = "http://127.0.0.1:5173/second.html";

/** A second Tab the Session hosts, idle: once it swapped a build in, the
 * Session has handed that build to every Tab, so a Tab that has not swapped
 * it by then is held. The first Tab stays the most recently active. */
async function idleTab(
  session: { ask(request: object): Promise<unknown> },
  browser: ScriptedBrowser
) {
  const idle = browser.openTab(SECOND_TAB);
  await session.ask({ tools: { tab: SECOND_TAB } });
  browser.activate();
  return idle;
}

it("an edit during a Run is swapped in once the Run ended, once, before the first of the commands that waited for it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const first = session.ask(remove);
  await browser.until(() => browser.runs.length === 1);
  const idle = await idleTab(session, browser);
  const second = session.ask(readHeading);
  const third = session.ask(readHeading);

  await rebuilt(browser, EDITED);
  await browser.until(() => idle.swappedIn.length === 1);
  expect(browser.swappedIn).toEqual([]);

  runs.end();
  expect(await first).toMatchObject({ ok: true });
  await browser.until(() => browser.runs.length === 2);
  runs.end();
  expect(await second).toMatchObject({ ok: true });
  await browser.until(() => browser.runs.length === 3);
  runs.end();
  expect(await third).toMatchObject({ ok: true });
  expect(runs.swapsSeen).toEqual([0, 1, 1]);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("an edit while a stopped action holds the Tab's turn is swapped in once that action ended, before the command that waited for it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await browser.until(() => browser.runs.length === 1);
  const idle = await idleTab(session, browser);
  browser.openDialog(confirm);
  browser.dialogStaysOpen();
  expect(await call).toMatchObject({ ok: false });
  browser.closeDialog();
  const next = session.ask(readHeading);

  await rebuilt(browser, EDITED);
  await browser.until(() => idle.swappedIn.length === 1);
  expect(browser.swappedIn).toEqual([]);

  runs.end(new RunError("RunStoppedError: the Run stopped at a dialog."));
  await browser.until(() => browser.runs.length === 2);
  runs.end();
  expect(await next).toMatchObject({ ok: true });
  expect(runs.swapsSeen).toEqual([0, 1]);
});

it("an open dialog does not hold up a Swap, which reads no page", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  browser.openDialog(confirm);
  browser.dialogStaysOpen();

  await rebuilt(browser, EDITED);

  await browser.until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("a failed build swaps nothing in, and listings say so after their Tab line until a build succeeds", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });

  await browser.edit();
  await browser.until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: `Tab t1: Shop (http://127.0.0.1:5173/shop.html)\n${BUILD_LINE}\nThis screen has no Page Object Tools.`,
    data: {
      tab: { id: "t1", ...shop.tab },
      tools: [],
      buildFailing: BUILD_LINE,
    },
  });
  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    ok: true,
    text: `Tab t1: Shop (http://127.0.0.1:5173/shop.html)\n${BUILD_LINE}\nShopPage\nThis screen has 0 Page Object Tools: ayme -s=default tools lists them with their parameters.`,
  });
  expect(browser.swappedIn).toEqual([]);

  await rebuilt(browser, EDITED);
  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: "Tab t1: Shop (http://127.0.0.1:5173/shop.html)\nThis screen has no Page Object Tools.",
    data: { tab: { id: "t1", ...shop.tab }, tools: [] },
  });
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("a listing reports the last finished build, not one still under way", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.started;
  await browser.edit();
  await browser.until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  await browser.edit();
  await browser.until(() => browser.builds === 3);
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);

  browser.finishBuild(EDITED);
  await browser.until(() => browser.swappedIn.length > 0);
  expect((await session.ask({ tools: {} })).text).not.toContain(BUILD_LINE);
});

it("a listing while a dialog is open keeps the build line after its Tab line", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  await browser.edit();
  await browser.until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);
  browser.openDialog(confirm);
  browser.dialogStaysOpen();

  expect(await session.ask({ tools: {} })).toEqual({
    ok: false,
    text: `Tab t1: http://127.0.0.1:5173/shop.html\n${BUILD_LINE}\nA confirm dialog is open on the tab: "Remove Milk from the basket?". Answer it with your browser automation, then run this command again.`,
  });
});

it("a good build still waiting for its Swap is dropped when a later edit fails to build", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const first = session.ask(remove);
  await browser.until(() => browser.runs.length === 1);

  await rebuilt(browser, EDITED);
  await browser.edit();
  await browser.until(() => browser.builds === 3);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  runs.end();
  await first;
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);
  expect(browser.swappedIn).toEqual([]);
});

it("the newest edit wins: a build that finishes after a newer edit is dropped, and the build of the newer edit is swapped in", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });

  await browser.edit();
  await browser.until(() => browser.builds === 2);
  await browser.edit();
  browser.finishBuild(EDITED);
  await browser.until(() => browser.builds === 3);
  expect(browser.swappedIn).toEqual([]);

  browser.finishBuild(LATER);
  await browser.until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([LATER]);
});

it("a Tab the Session works on for the first time after a Swap runs the rebuilt Page Objects", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swappedIn.length > 0);

  const popup = browser.openTab("http://127.0.0.1:5173/popup.html");
  await session.ask({ tools: {} });
  expect(popup.startedWith).toBe(EDITED);
  expect(popup.swappedIn).toEqual([]);
  expect(browser.startedWith).toBe(SCRIPTED_PAGE_OBJECTS);
});

it("an id given before a Swap still chooses its Tab after it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  browser.give("po1", "Basket");
  const other = browser.openTab("http://127.0.0.1:5173/other.html");
  await session.ask({ tools: {} });

  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swappedIn.length > 0);
  await session.ask(remove);

  expect(browser.runs).toEqual([remove.call]);
  expect(other.runs).toEqual([]);
});

it("an open Inspector window keeps its Tab across a Swap, whose Host tells it the swapped Page Objects", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: "http://127.0.0.1:4500/inspector",
  });
  const window = session.listen();
  await browser.until(() => browser.inspectorListeners > 0);

  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swappedIn.length > 0);
  browser.tellInspector({ registry: "the swapped Page Objects" });

  await browser.until(() => window.heard.some((event) => "contract" in event));
  expect(window.heard).toEqual([
    { tab: 1 },
    { contract: { registry: "the swapped Page Objects" } },
  ]);
});

it("a good build that a later edit broke is dropped on every Tab that had not swapped it in yet, and kept on a Tab that had", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  const second = browser.openTab(SECOND_TAB);
  const runs = holdRuns(second);
  const held = session.ask({ call: { ...readHeading.call, tab: SECOND_TAB } });
  await browser.until(() => second.runs.length === 1);

  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swappedIn.length > 0);
  await browser.edit();
  await browser.until(() => browser.builds === 3);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);
  runs.end();
  await held;

  expect((await session.ask({ tools: { tab: SECOND_TAB } })).text).toContain(
    BUILD_LINE
  );
  expect(second.swappedIn).toEqual([]);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("every finished build sets the build line, also one a newer edit overtook while it ran", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });

  await browser.edit();
  await browser.until(() => browser.builds === 2);
  await browser.edit();
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);
  await browser.until(() => browser.builds === 3);
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);

  await browser.edit();
  browser.finishBuild(EDITED);
  await browser.until(() => browser.builds === 4);
  expect((await session.ask({ tools: {} })).text).not.toContain(BUILD_LINE);
  expect(browser.swappedIn).toEqual([]);
});

it("a Tab that closed while a Run held it swaps nothing in once the Run ends, however many builds waited", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await browser.until(() => browser.runs.length === 1);
  const second = browser.openTab(SECOND_TAB);
  await session.ask({ tools: { tab: SECOND_TAB } });

  await rebuilt(browser, EDITED);
  await browser.until(() => second.swappedIn.length === 1);
  await rebuilt(browser, LATER);
  await browser.until(() => second.swappedIn.length === 2);
  browser.close();
  expect(await call).toMatchObject({ ok: false });
  runs.end();

  // A Swap that waited for the Run would come before a later build is.
  await rebuilt(browser, Object.freeze({ built: "after a third edit" }));
  await browser.until(() => second.swappedIn.length === 3);
  expect(browser.swappedIn).toEqual([]);
});

const NO_BASKET = "Basket could not be made: this page has no basket.";

it("a build a Tab cannot register counts there as a failed build: the Tab keeps its classes, its commands work, its listings say why, and it is not tried again", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  const second = browser.openTab(SECOND_TAB);
  await session.ask({ tools: { tab: SECOND_TAB } });
  browser.refuseSwaps(NO_BASKET);

  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swapsTried.length === 1);
  await browser.until(() => second.swappedIn.length === 1);

  expect(await session.ask({ tools: { tab: shop.tab.url } })).toEqual({
    ok: true,
    text: `Tab t1: Shop (http://127.0.0.1:5173/shop.html)\nPage Object rebuild failed on this Tab. Keeping its current Page Objects. ${NO_BASKET}\nThis screen has no Page Object Tools.`,
    data: {
      tab: { id: "t1", ...shop.tab },
      tools: [],
      buildFailing: `Page Object rebuild failed on this Tab. Keeping its current Page Objects. ${NO_BASKET}`,
    },
  });
  expect(
    await session.ask({ call: { ...readHeading.call, tab: shop.tab.url } })
  ).toMatchObject({ ok: true });
  expect(browser.swapsTried).toEqual([EDITED]);
  expect(
    (await session.ask({ tools: { tab: SECOND_TAB } })).text
  ).not.toContain(NO_BASKET);

  browser.refuseSwaps(undefined);
  await rebuilt(browser, LATER);
  await browser.until(() => browser.swappedIn.length === 1);
  expect(
    (await session.ask({ tools: { tab: shop.tab.url } })).text
  ).not.toContain(NO_BASKET);
  expect(browser.swappedIn).toEqual([LATER]);
});

it("once a Swap takes a class's root away, an action parameter named id is no Page Object Id and chooses no Tab", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  browser.give("po1", "Panel");
  const second = browser.openTab(SECOND_TAB);
  await session.ask({ tools: {} });

  await rebuilt(browser, EDITED);
  await browser.until(() => browser.swappedIn.length > 0);
  browser.rootless("Panel");
  const open = { tool: "Panel.open", input: { id: "po1" } };
  expect(await session.ask({ call: open })).toMatchObject({ ok: true });

  expect(second.runs).toEqual([open]);
  expect(browser.runs).toEqual([]);
});

it("a Run from the Inspector window reads the page in its turn before it runs, also the first one after a Swap", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    inspector: "http://127.0.0.1:4500/inspector",
  });
  const window = await windowOn(session);
  const runs = holdRuns(browser);
  void session.ask(remove);
  await browser.until(() => browser.runs.length === 1);
  const seen: { swaps: number; observed: number }[] = [];
  browser.answerInspector(async () => {
    seen.push({ swaps: browser.swappedIn.length, observed: browser.observed });
    return { ok: true };
  });
  const run = window.ask("runTool", {
    name: "Basket.clear",
    input: {},
    by: "inspector",
  });
  await rebuilt(browser, EDITED);

  runs.end();
  await run;
  expect(seen).toEqual([{ swaps: 1, observed: 1 }]);
});

it("a Run answered early by an error its code left uncaught keeps the Tab's turn until its work ended: the Swap and the next command wait for it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  let endWork!: () => void;
  const going = new Promise<void>((resolve) => (endWork = resolve));
  browser.answerRuns(() =>
    Promise.reject(new RunError("Error: the timer threw.", undefined, going))
  );
  expect(await session.ask(remove)).toMatchObject({ ok: false });
  const idle = await idleTab(session, browser);
  const order: string[] = [];
  browser.answerRuns(async () => {
    order.push(`a Run after ${browser.swappedIn.length} Swaps`);
    return { settled: true };
  });
  const next = session.ask(readHeading);

  await rebuilt(browser, EDITED);
  await browser.until(() => idle.swappedIn.length === 1);
  expect(browser.swappedIn).toEqual([]);

  order.push("the work ended");
  endWork();
  expect(await next).toMatchObject({ ok: true });
  expect(order).toEqual(["the work ended", "a Run after 1 Swaps"]);
});

it("a Session that ends while a rebuild is under way ends at once, stops listening for edits, and swaps nothing in", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  await browser.edit();
  await browser.until(() => browser.builds === 2);

  expect(await session.ask({ stop: {} })).toMatchObject({ ok: true });
  expect(await session.ended).toBe("stopped");
  expect(browser.watched).toBe(false);
  expect(browser.released).toBe(true);

  browser.finishBuild(EDITED);
  expect(browser.swappedIn).toEqual([]);
});

it("a listing says so after its Tab line while the source cannot be watched", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  browser.loseWatch("/app/ayme/pom: EMFILE: too many open files, watch");

  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    "The Page Objects' source cannot be watched, so an edit may not be rebuilt. /app/ayme/pom: EMFILE: too many open files, watch"
  );
  browser.loseWatch(undefined);
  expect((await session.ask({ tools: {} })).text).not.toContain("EMFILE");
});

it("a listing answered that a dialog is open leaves the Tab's turn, so a Swap comes while the dialog is still open", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  browser.holdReads();
  const listing = session.ask({ tools: {} });
  browser.openDialog(confirm);
  browser.dialogStaysOpen();
  expect(await listing).toMatchObject({ ok: false });

  await rebuilt(browser, EDITED);

  await browser.until(() => browser.swappedIn.length === 1);
  expect(browser.swappedIn).toEqual([EDITED]);
});
