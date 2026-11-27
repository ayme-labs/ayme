import { expect, it } from "vitest";

import { RunError, type RunAnswer } from "./session/domain";
import {
  SCRIPTED_PAGE_OBJECTS,
  startScriptedSession,
  type ScriptedBrowser,
  type ScriptedTab,
} from "../testing";

// Rebuilds and Swaps (rule 7), through the Session's interface on the
// scripted browser, where the test edits the source and finishes or fails
// each build by hand: the orderings of builds, Runs and Swaps the Session's
// statechart model checked.

const opening = { open: { headed: false } } as const;

/** Resolves once `holds()` is true, after as few turns of the event loop
 * as it takes; fails when it never is. */
async function until(holds: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    if (holds()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("It never happened.");
}

const EDITED = Object.freeze({ built: "after the edit" });

it("an edit makes the Session rebuild, and the rebuilt Page Objects are swapped in on its Tab with no command waiting", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });

  browser.edit();
  await until(() => browser.builds === 2);
  expect(browser.swappedIn).toEqual([]);
  browser.finishBuild(EDITED);

  await until(() => browser.swappedIn.length > 0);
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

const BUILD_LINE = `The Page Objects do not build since the last edit, so the Session keeps the ones it has: ${FIRST_ERROR}`;

it("the build line names the first error whole on one line, and a failure without one by the first line of its message", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.started;
  browser.edit();
  await until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, `${FIRST_ERROR} in {\n  more of it\n}`);
  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    `${BUILD_LINE} in { more of it }`
  );

  browser.edit();
  await until(() => browser.builds === 3);
  browser.failBuild("The Page Objects did not load: x is not defined\nat …");
  expect((await session.ask({ tools: {} })).text.split("\n")[1]).toBe(
    "The Page Objects do not build since the last edit, so the Session keeps the ones it has: The Page Objects did not load: x is not defined"
  );
});

/** Whether `promise` is still pending once everything ready to run ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

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
  browser.edit();
  await until(() => browser.builds === before + 1);
  browser.finishBuild(built);
}

it("an edit during a Run is swapped in only once the Run ended, before the command that waited for it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const first = session.ask(remove);
  await until(() => browser.runs.length === 1);
  const next = session.ask(readHeading);

  await rebuilt(browser, EDITED);
  expect(await pending(first)).toBe(true);
  expect(browser.swappedIn).toEqual([]);

  runs.end();
  await first;
  await until(() => browser.runs.length === 2);
  expect(browser.swappedIn).toEqual([EDITED]);
  expect(runs.swapsSeen).toEqual([0, 1]);
  runs.end();
  expect(await next).toMatchObject({ ok: true });
});

it("two commands waiting for the Tab's turn: the Swap comes once, before the first of them", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  void session.ask(remove);
  await until(() => browser.runs.length === 1);
  const second = session.ask(readHeading);
  const third = session.ask(readHeading);
  await rebuilt(browser, EDITED);

  runs.end();
  await until(() => browser.runs.length === 2);
  runs.end();
  await second;
  await until(() => browser.runs.length === 3);
  runs.end();
  await third;
  expect(runs.swapsSeen).toEqual([0, 1, 1]);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("an edit while a stopped action holds the Tab's turn is swapped in once that action ended", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await until(() => browser.runs.length === 1);
  browser.openDialog(confirm);
  browser.dialogStaysOpen();
  expect(await call).toMatchObject({ ok: false });

  await rebuilt(browser, EDITED);
  browser.closeDialog();
  expect(await pending(until(() => browser.swappedIn.length > 0))).toBe(true);

  runs.end(new RunError("RunStoppedError: the Run stopped at a dialog."));
  await until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("an open dialog does not hold up a Swap, which reads no page", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  browser.openDialog(confirm);
  browser.dialogStaysOpen();

  await rebuilt(browser, EDITED);

  await until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("a failed build swaps nothing in, and listings say so after their Tab line until a build succeeds", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });

  browser.edit();
  await until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: `Tab: Shop (http://127.0.0.1:5173/shop.html)\n${BUILD_LINE}\nThis screen has no Page Object Tools.`,
    data: { tab: shop.tab, tools: [], buildFailing: BUILD_LINE },
  });
  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    ok: true,
    text: `Tab: Shop (http://127.0.0.1:5173/shop.html)\n${BUILD_LINE}\nShopPage\nThis screen has 0 Page Object Tools: ayme -s=default tools lists them with their parameters.`,
  });
  expect(browser.swappedIn).toEqual([]);

  await rebuilt(browser, EDITED);
  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: "Tab: Shop (http://127.0.0.1:5173/shop.html)\nThis screen has no Page Object Tools.",
    data: { tab: shop.tab, tools: [] },
  });
  expect(browser.swappedIn).toEqual([EDITED]);
});

it("a listing reports the last finished build, not one still under way", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.started;
  browser.edit();
  await until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  browser.edit();
  await until(() => browser.builds === 3);
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);

  browser.finishBuild(EDITED);
  await until(() => browser.swappedIn.length > 0);
  expect((await session.ask({ tools: {} })).text).not.toContain(BUILD_LINE);
});

it("a listing while a dialog is open keeps the build line after its Tab line", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ tools: {} });
  browser.edit();
  await until(() => browser.builds === 2);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);
  browser.openDialog(confirm);
  browser.dialogStaysOpen();

  expect(await session.ask({ tools: {} })).toEqual({
    ok: false,
    text: `Tab: http://127.0.0.1:5173/shop.html\n${BUILD_LINE}\nA confirm dialog is open on the tab: "Remove Milk from the basket?". Answer it with your browser automation, then run ayme again.`,
  });
});

it("a good build still waiting for its Swap is dropped when a later edit fails to build", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const first = session.ask(remove);
  await until(() => browser.runs.length === 1);

  await rebuilt(browser, EDITED);
  browser.edit();
  await until(() => browser.builds === 3);
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);

  runs.end();
  await first;
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);
  expect(browser.swappedIn).toEqual([]);
});

it("the newest edit wins: a build that finishes after a newer edit is dropped, and the build of the newer edit is swapped in", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });

  browser.edit();
  await until(() => browser.builds === 2);
  browser.edit();
  // The Session hears of the edit in the turns that follow it.
  await pending(new Promise(() => {}));
  browser.finishBuild(EDITED);
  await until(() => browser.builds === 3);
  expect(browser.swappedIn).toEqual([]);

  browser.finishBuild(LATER);
  await until(() => browser.swappedIn.length > 0);
  expect(browser.swappedIn).toEqual([LATER]);
});

it("a Tab the Session works on for the first time after a Swap runs the rebuilt Page Objects", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  await rebuilt(browser, EDITED);
  await until(() => browser.swappedIn.length > 0);

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
  await until(() => browser.swappedIn.length > 0);
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
  await until(() => browser.inspectorListeners > 0);

  await rebuilt(browser, EDITED);
  await until(() => browser.swappedIn.length > 0);
  browser.tellInspector({ registry: "the swapped Page Objects" });

  await until(() => window.heard.some((event) => "contract" in event));
  expect(window.heard).toEqual([
    { tab: 1 },
    { contract: { registry: "the swapped Page Objects" } },
  ]);
});

const SECOND_TAB = "http://127.0.0.1:5173/second.html";

it("a good build that a later edit broke is dropped on every Tab that had not swapped it in yet, and kept on a Tab that had", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ tools: {} });
  const second = browser.openTab(SECOND_TAB);
  const runs = holdRuns(second);
  const held = session.ask({ call: { ...readHeading.call, tab: SECOND_TAB } });
  await until(() => second.runs.length === 1);

  await rebuilt(browser, EDITED);
  await until(() => browser.swappedIn.length > 0);
  browser.edit();
  await until(() => browser.builds === 3);
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

  browser.edit();
  await until(() => browser.builds === 2);
  browser.edit();
  await pending(new Promise(() => {}));
  browser.failBuild(BUILD_ERRORS, FIRST_ERROR);
  await until(() => browser.builds === 3);
  expect((await session.ask({ tools: {} })).text).toContain(BUILD_LINE);

  browser.edit();
  await pending(new Promise(() => {}));
  browser.finishBuild(EDITED);
  await until(() => browser.builds === 4);
  expect((await session.ask({ tools: {} })).text).not.toContain(BUILD_LINE);
  expect(browser.swappedIn).toEqual([]);
});

it("a Tab that closed while a Run held it swaps nothing in once the Run ends, however many builds waited", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const runs = holdRuns(browser);
  const call = session.ask(remove);
  await until(() => browser.runs.length === 1);
  const second = browser.openTab(SECOND_TAB);
  await session.ask({ tools: { tab: SECOND_TAB } });

  await rebuilt(browser, EDITED);
  await until(() => second.swappedIn.length === 1);
  await rebuilt(browser, LATER);
  await until(() => second.swappedIn.length === 2);
  browser.close();
  expect(await call).toMatchObject({ ok: false });
  runs.end();

  await pending(new Promise(() => {}));
  expect(browser.swappedIn).toEqual([]);
  expect(second.swappedIn).toEqual([EDITED, LATER]);
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
  await until(() => browser.swapsTried.length === 1);
  await until(() => second.swappedIn.length === 1);

  expect(await session.ask({ tools: { tab: shop.tab.url } })).toEqual({
    ok: true,
    text: `Tab: Shop (http://127.0.0.1:5173/shop.html)\nThe Page Objects do not build since the last edit, so the Session keeps the ones it has: ${NO_BASKET}\nThis screen has no Page Object Tools.`,
    data: {
      tab: shop.tab,
      tools: [],
      buildFailing: `The Page Objects do not build since the last edit, so the Session keeps the ones it has: ${NO_BASKET}`,
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
  await until(() => browser.swappedIn.length === 1);
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
  await until(() => browser.swappedIn.length > 0);
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
  const runs = holdRuns(browser);
  void session.ask(remove);
  await until(() => browser.runs.length === 1);
  const seen: { swaps: number; observed: number }[] = [];
  browser.answerInspector(async () => {
    seen.push({ swaps: browser.swappedIn.length, observed: browser.observed });
    return { ok: true };
  });
  const run = session.ask({
    inspector: {
      contract: {
        method: "runTool",
        params: { name: "Basket.clear", input: {}, by: "inspector" },
      },
    },
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
  const next = session.ask(readHeading);

  await rebuilt(browser, EDITED);
  await pending(new Promise(() => {}));
  expect(browser.swappedIn).toEqual([]);
  expect(browser.runs).toHaveLength(1);

  browser.answerRuns(() => Promise.resolve({ settled: true }));
  endWork();
  expect(await next).toMatchObject({ ok: true });
  expect(browser.swappedIn).toEqual([EDITED]);
});
