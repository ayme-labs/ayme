import { expect, it } from "vitest";

import { RunError } from "./session/domain";
import { SCRIPTED_PAGE_OBJECTS, startScriptedSession } from "../testing";

it("a Session opens the browser it is asked for and answers its start with the browser's address", async () => {
  const { session, browser } = await startScriptedSession({
    open: { url: "http://127.0.0.1:5173/", headed: false },
  });

  expect(await session.started).toEqual({
    ok: true,
    text: expect.stringContaining("http://127.0.0.1:9222"),
    data: { address: "http://127.0.0.1:9222" },
  });
  expect(browser.asked).toEqual([
    { open: { url: "http://127.0.0.1:5173/", headed: false } },
  ]);
});

const opening = { open: { headed: false } } as const;

/** Whether `promise` is still pending once everything ready to run ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

it("stop ends the Session and closes the browser ayme opened", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.started;

  expect(await session.ask({ stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  expect(browser.released).toBe(true);
  expect(await session.ended).toBe("stopped");
});

it("the Session ends when its browser goes away, and a later stop says so", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.started;

  browser.goAway();

  expect(await session.ended).toBe("browser gone");
  expect(await session.ask({ stop: {} })).toEqual({
    ok: false,
    text: "The Session had already ended: its browser went away.",
  });
});

it("a request sent while the Session starts waits for the start to succeed", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });

  // A listing waits as every request but stop does.
  const answer = session.ask({ tools: {} });
  expect(await pending(answer)).toBe(true);
  browser.open();

  expect(await answer).toEqual({
    ok: true,
    text: "Tab: about:blank\nThis screen has no Page Object Tools.",
    data: { tab: { url: "about:blank", title: "" }, tools: [] },
  });
});

it("a stop sent while the Session starts ends the start: the browser is let go, and the start is answered so", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });
  await pending(session.started);
  expect(browser.asked).toHaveLength(1);

  expect(await session.ask({ stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  expect(browser.released).toBe(true);
  expect(await session.started).toEqual({
    ok: false,
    text: "ayme close ended the Session before it started.",
  });
  expect(await session.ended).toBe("stopped");
});

it("a browser that goes away as the start ends is no Session: the start is answered so, and the Session ends", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });

  browser.goAway();
  browser.open();

  expect(await session.started).toEqual({
    ok: false,
    text: "The browser went away before the Session started.",
  });
  expect(await session.ended).toBe("browser gone");
});

it("a start that breaks unexpectedly is answered with what broke, and the Session ends", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });
  const waiting = session.ask({ pageObjects: {} });

  browser.breakOpen(new Error("EACCES: permission denied, mkdtemp"));

  const why = {
    ok: false,
    text: expect.stringContaining("EACCES: permission denied, mkdtemp"),
  };
  expect(await session.started).toEqual(why);
  expect(await waiting).toEqual(why);
  expect(await session.ended).toBe("start failed");
});

it("when the start fails, the start and every request waiting for it are answered with why, and the Session ends", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });
  const waiting = session.ask({ pageObjects: {} });

  browser.failOpen("Playwright could not open Chromium.");

  const why = { ok: false, text: "Playwright could not open Chromium." };
  expect(await session.started).toEqual(why);
  expect(await waiting).toEqual(why);
  expect(await session.ask({ stop: {} })).toEqual(why);
  expect(await session.ended).toBe("start failed");
});

const tab = {
  url: "http://127.0.0.1:5173/basket.html",
  title: "Groceries",
};

const readHeading = {
  name: "Basket.readHeading",
  description: "Read the basket's heading.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  available: true,
};

const clear = {
  name: "Basket.clear",
  description: "Clear the basket.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  available: false,
  reason: "The basket is empty",
};

it("page-objects answers the Page Object Tree, after a line naming the Tab and before one saying how many tools ayme tools lists", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show({
    tab,
    pageObjectTree: "Basket po1\n  heading: heading [level=1]: Groceries",
    tools: [readHeading, clear],
  });

  expect(await session.ask({ pageObjects: {} })).toEqual({
    ok: true,
    text: [
      "Tab: Groceries (http://127.0.0.1:5173/basket.html)",
      "Basket po1",
      "  heading: heading [level=1]: Groceries",
      "This screen has 2 Page Object Tools: ayme tools lists them with their parameters.",
    ].join("\n"),
    data: {
      tab,
      pageObjectTree: "Basket po1\n  heading: heading [level=1]: Groceries",
      tools: 2,
    },
  });
});

it("tools lists every Page Object Tool of the Tab with its parameters, an unavailable one with why", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show({
    tab,
    pageObjectTree: "Basket po1",
    tools: [readHeading, clear],
  });

  expect(await session.ask({ tools: {} })).toEqual({
    ok: true,
    text: [
      "Tab: Groceries (http://127.0.0.1:5173/basket.html)",
      "Basket.readHeading: Read the basket's heading.",
      '  parameters: {"type":"object","properties":{},"additionalProperties":false}',
      "Basket.clear (unavailable: The basket is empty): Clear the basket.",
      '  parameters: {"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"additionalProperties":false}',
    ].join("\n"),
    data: { tab, tools: [readHeading, clear] },
  });
});

it("a screen without Page Object Tools says so in both listings", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show({
    tab: { url: "http://127.0.0.1:5173/plain.html", title: "" },
    pageObjectTree: "No Page Object is on the page.",
    tools: [],
  });

  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    text: "Tab: http://127.0.0.1:5173/plain.html\nNo Page Object is on the page.\nThis screen has no Page Object Tools.",
  });
  expect(await session.ask({ tools: {} })).toMatchObject({
    text: "Tab: http://127.0.0.1:5173/plain.html\nThis screen has no Page Object Tools.",
  });
});

it("one Page Object Tool is counted as one, and a tool that says nothing is listed by its name", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const silent = { name: "Basket.empty", parameters: {}, available: false };
  browser.show({ tab, pageObjectTree: "Basket", tools: [silent] });

  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    text: expect.stringMatching(
      /\nThis screen has 1 Page Object Tool: ayme tools lists it with its parameters\.$/
    ),
  });
  expect(await session.ask({ tools: {} })).toMatchObject({
    text: expect.stringMatching(
      /\nBasket\.empty \(unavailable\)\n {2}parameters: \{\}$/
    ),
  });
});

it("a listing whose read of the page fails is answered with why, and the Session goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.failReads("The page closed while ayme read it.");

  const why = { ok: false, text: "The page closed while ayme read it." };
  expect(await session.ask({ pageObjects: {} })).toEqual(why);
  expect(await session.ask({ tools: {} })).toEqual(why);

  browser.show({ tab, pageObjectTree: "Basket", tools: [] });
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
});

it("the Session builds the project's Page Objects at its start and runs the built ones on its Tab", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    heldBuild: true,
  });

  const listing = session.ask({ pageObjects: {} });
  expect(await pending(session.started)).toBe(true);
  expect(await pending(listing)).toBe(true);
  browser.finishBuild();

  expect(await session.started).toMatchObject({ ok: true });
  expect(await listing).toMatchObject({ ok: true });
  expect(browser.hostedWith).toEqual([SCRIPTED_PAGE_OBJECTS]);
});

it("when the first build fails, no Session starts: the start says why, and the browser ayme opened is closed", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    heldBuild: true,
  });
  const waiting = session.ask({ tools: {} });

  browser.failBuild(
    'The Page Objects did not build:\nayme/pom/Basket.ts:3:9: ERROR: Expected ";" but found "basket"'
  );

  const why = {
    ok: false,
    text: 'The Page Objects did not build:\nayme/pom/Basket.ts:3:9: ERROR: Expected ";" but found "basket"',
  };
  expect(await session.started).toEqual(why);
  expect(await waiting).toEqual(why);
  expect(await session.ended).toBe("start failed");
  expect(browser.released).toBe(true);
  expect(browser.hostedWith).toEqual([]);
});

it("a build that fails while the browser still opens ends the start: the start says why, and the browser is let go", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
    heldBuild: true,
  });
  await pending(session.started);
  expect(browser.asked).toHaveLength(1);

  browser.failBuild("The Page Objects did not build.");

  expect(await session.started).toEqual({
    ok: false,
    text: "The Page Objects did not build.",
  });
  expect(browser.released).toBe(true);
  expect(await session.ended).toBe("start failed");
});

it("a browser that fails to open while the build runs ends the start with why", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
    heldBuild: true,
  });

  browser.failOpen("Playwright could not open Chromium.");

  expect(await session.started).toEqual({
    ok: false,
    text: "Playwright could not open Chromium.",
  });
  expect(await session.ended).toBe("start failed");
  expect(browser.hostedWith).toEqual([]);
});

it("a stop sent while the Page Objects still build ends the start, and the browser ayme opened is closed", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    heldBuild: true,
  });
  expect(await pending(session.started)).toBe(true);

  expect(await session.ask({ stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  expect(browser.released).toBe(true);
  expect(await session.started).toEqual({
    ok: false,
    text: "ayme close ended the Session before it started.",
  });
  expect(await session.ended).toBe("stopped");
  expect(browser.hostedWith).toEqual([]);
});

it("call starts a Run of the tool on the Tab and answers the short answer: what the action returned, the URL it changed to, and how the Page Object Tree changed", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const answer = {
    settled: true,
    result: { total: 2 },
    url: "http://127.0.0.1:5173/basket.html#full",
    changes: 'Basket po1\n  items: [] → ["Milk"]',
  };
  browser.answerRuns(async () => answer);

  expect(
    await session.ask({
      call: {
        tool: "Basket.add",
        input: { id: "po1", args: { item: "Milk" } },
      },
    })
  ).toEqual({
    ok: true,
    text: [
      "settled: true",
      'result: {"total":2}',
      "url: http://127.0.0.1:5173/basket.html#full",
      "changes:",
      "Basket po1",
      '  items: [] → ["Milk"]',
    ].join("\n"),
    data: answer,
  });
  expect(browser.runs).toEqual([
    { tool: "Basket.add", input: { id: "po1", args: { item: "Milk" } } },
  ]);
});

it("a Run that returned nothing and changed nothing answers only whether the page settled", async () => {
  const { session } = await startScriptedSession(opening);

  expect(
    await session.ask({ call: { tool: "Basket.add", input: {} } })
  ).toEqual({ ok: true, text: "settled: true", data: { settled: true } });
});

it("a failed Run is answered with why and how the Page Object Tree changed while it ran, and the Session goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerRuns(async () => {
    throw new RunError(
      "TimeoutError: locator.click: Timeout 30000ms exceeded.",
      'Basket po1\n  items: [] → ["Milk"]'
    );
  });

  expect(
    await session.ask({ call: { tool: "Basket.add", input: { id: "po1" } } })
  ).toEqual({
    ok: false,
    text: [
      "TimeoutError: locator.click: Timeout 30000ms exceeded.",
      "",
      "changes:",
      "Basket po1",
      '  items: [] → ["Milk"]',
    ].join("\n"),
  });

  browser.answerRuns(async () => ({ settled: true, result: "Groceries" }));
  expect(
    await session.ask({ call: { tool: "Basket.readHeading", input: {} } })
  ).toMatchObject({ ok: true, text: 'settled: true\nresult: "Groceries"' });
});

it("a Run under way when the Session is stopped is answered that the Session was closed", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerRuns(() => new Promise(() => {}));
  const call = session.ask({ call: { tool: "Basket.hold", input: {} } });
  expect(await pending(call)).toBe(true);

  await session.ask({ stop: {} });

  expect(await call).toEqual({
    ok: false,
    text: "The Session was closed before it answered this command.",
  });
});

it("a Run under way when the browser goes away is answered so", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerRuns(() => new Promise(() => {}));
  const call = session.ask({ call: { tool: "Basket.hold", input: {} } });
  expect(await pending(call)).toBe(true);

  browser.goAway();

  expect(await call).toEqual({
    ok: false,
    text: "The Session ended before it answered this command: its browser went away.",
  });
});

it("a listing that never ends, as behind a presence predicate that never resolves, is answered when the Session is stopped", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.holdReads();
  const listing = session.ask({ pageObjects: {} });
  expect(await pending(listing)).toBe(true);

  expect(await session.ask({ stop: {} })).toMatchObject({ ok: true });
  expect(await listing).toEqual({
    ok: false,
    text: "The Session was closed before it answered this command.",
  });
  expect(await session.ended).toBe("stopped");
});

const joining = { join: { cdp: "http://127.0.0.1:9333" } } as const;

it("a Session joins the browser it is asked to and answers its start with that browser's address", async () => {
  const { session, browser } = await startScriptedSession(joining);

  expect(await session.started).toEqual({
    ok: true,
    text: "A Session started on the browser at http://127.0.0.1:9333.\nayme detach ends the Session and leaves the browser running.",
    data: { address: "http://127.0.0.1:9333" },
  });
  expect(browser.asked).toEqual([joining]);
});

it.each([["stop" as const], ["detach" as const]])(
  "%s on a joined browser ends the Session and leaves the browser running",
  async (word) => {
    const { session, browser } = await startScriptedSession(joining);
    await session.started;

    expect(await session.ask({ [word]: {} } as never)).toEqual({
      ok: true,
      text: "The Session ended. Its browser keeps running.",
    });
    // A joined browser is only let go of: the stock adapter disconnects.
    expect(browser.released).toBe(true);
    expect(await session.ended).toBe(word === "stop" ? "stopped" : "detached");
  }
);

it("detach on a browser ayme opened is refused with a pointer to ayme close, and the Session goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.started;

  expect(await session.ask({ detach: {} })).toEqual({
    ok: false,
    text: "ayme opened this Session's browser, so ayme detach would leave it without an owner. End the Session and close the browser with ayme close.",
  });
  expect(browser.released).toBe(false);
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
});

it("detach on a browser ayme opens is refused also while the Session starts, and the start goes on", async () => {
  const { session, browser } = await startScriptedSession({
    ...opening,
    held: true,
  });

  expect(await session.ask({ detach: {} })).toMatchObject({ ok: false });
  browser.open();
  expect(await session.started).toMatchObject({ ok: true });
});

it("a detach sent while a join is under way ends the start, and the start is answered so", async () => {
  const { session, browser } = await startScriptedSession({
    ...joining,
    held: true,
  });
  await pending(session.started);

  expect(await session.ask({ detach: {} })).toEqual({
    ok: true,
    text: "The Session ended. Its browser keeps running.",
  });
  expect(browser.released).toBe(true);
  expect(await session.started).toEqual({
    ok: false,
    text: "ayme detach ended the Session before it started.",
  });
  expect(await session.ended).toBe("detached");
});

it("detach after the joined browser went away says the Session had already ended", async () => {
  const { session, browser } = await startScriptedSession(joining);
  await session.started;

  browser.goAway();

  expect(await session.ended).toBe("browser gone");
  expect(await session.ask({ detach: {} })).toEqual({
    ok: false,
    text: "The Session had already ended: its browser went away.",
  });
});

const shop = {
  tab: { url: "http://127.0.0.1:5173/shop.html", title: "Shop" },
  pageObjectTree: "ShopPage",
  tools: [],
};

const signIn = {
  tab: { url: "http://127.0.0.1:5173/sign-in.html", title: "Sign in" },
  pageObjectTree: "SignInPage",
  tools: [],
};

it("a listing reads the most recently active Tab, and follows the browser automation to another", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  const other = browser.openTab();
  other.show(signIn);

  expect(await session.ask({ pageObjects: {} })).toMatchObject({
    text: expect.stringMatching(
      /^Tab: Sign in \(http:\/\/127\.0\.0\.1:5173\/sign-in\.html\)\nSignInPage\n/
    ),
  });

  browser.activate();
  expect(await session.ask({ tools: {} })).toMatchObject({
    text: expect.stringMatching(/^Tab: Shop \(/),
  });
});

it("--tab names another Tab by the URL its page shows, as the listing's first line prints it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  browser.openTab().show(signIn);

  expect(
    await session.ask({ pageObjects: { tab: shop.tab.url } })
  ).toMatchObject({ ok: true, text: expect.stringMatching(/^Tab: Shop \(/) });
  expect(await session.ask({ tools: { tab: shop.tab.url } })).toMatchObject({
    ok: true,
    text: expect.stringMatching(/^Tab: Shop \(/),
  });
  // Naming a Tab does not make it the most recently active one.
  expect(await session.ask({ tools: {} })).toMatchObject({
    text: expect.stringMatching(/^Tab: Sign in \(/),
  });
});

it("--tab naming a URL no Tab shows is answered with the URLs the open Tabs show", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  browser.openTab().show(signIn);

  expect(
    await session.ask({ pageObjects: { tab: "http://127.0.0.1:5173/" } })
  ).toEqual({
    ok: false,
    text: "No tab of the Session's browser shows http://127.0.0.1:5173/. --tab takes the URL a tab shows, as the first line of ayme page-objects prints it. The open tabs show: http://127.0.0.1:5173/sign-in.html, http://127.0.0.1:5173/shop.html.",
  });
});

it("when the Tab closes, the Session works on the next most recently active one", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  const other = browser.openTab();
  other.show(signIn);
  expect(await session.ask({ tools: {} })).toMatchObject({
    text: expect.stringMatching(/^Tab: Sign in \(/),
  });

  other.close();

  expect(await session.ask({ tools: {} })).toMatchObject({
    text: expect.stringMatching(/^Tab: Shop \(/),
  });
});

it("with no Tab open, every command that needs one answers that no tab is open, and the Session goes on", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.close();
  const none = {
    ok: false,
    text: "No tab is open in the Session's browser. Open one with your browser automation, then run ayme again.",
  };

  expect(await session.ask({ pageObjects: {} })).toEqual(none);
  expect(await session.ask({ tools: {} })).toEqual(none);
  expect(
    await session.ask({ call: { tool: "ShopPage.readHeading", input: {} } })
  ).toEqual(none);

  browser.openTab().show(shop);
  expect(await session.ask({ tools: {} })).toMatchObject({ ok: true });
});

it("a listing the browser's tab list cannot be read for is answered with why", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.failTabList("ayme could not read the browser's tab list.");

  expect(await session.ask({ pageObjects: {} })).toEqual({
    ok: false,
    text: "ayme could not read the browser's tab list.",
  });
});

it("the Session is the Host only of the Tabs it works on, which turns focus emulation on for them", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const other = browser.openTab();
  expect([browser.hosted, other.hosted]).toEqual([false, false]);

  await session.ask({ tools: {} });
  expect([browser.hosted, other.hosted]).toEqual([false, true]);
});

it("a URL several Tabs show names the most recently active of them", async () => {
  const { session, browser } = await startScriptedSession(opening);
  const other = browser.openTab();

  await session.ask({
    call: { tool: "ShopPage.readHeading", input: {}, tab: "about:blank" },
  });

  expect([browser.runs, other.runs]).toEqual([
    [],
    [{ tool: "ShopPage.readHeading", input: {} }],
  ]);
});

const add = (id: string) => ({
  call: { tool: "Basket.add", input: { id, args: { item: "Milk" } } },
});

it("the Page Object Id in a call chooses the Tab whose Host gave it, whichever Tab is in front", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ pageObjects: {} });
  browser.give("po1");
  const other = browser.openTab();
  other.show(signIn);
  await session.ask({ pageObjects: {} });
  other.give("po2");

  expect(await session.ask(add("po1"))).toMatchObject({ ok: true });
  expect(await session.ask(add("po2"))).toMatchObject({ ok: true });

  expect(browser.runs).toEqual([add("po1").call]);
  expect(other.runs).toEqual([add("po2").call]);
});

it("a closed Tab's ids are gone: a call with one runs on the most recently active Tab, whose Host does not know it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  await session.ask({ pageObjects: {} });
  browser.give("po1");
  const other = browser.openTab();
  browser.activate();
  browser.close();

  await session.ask(add("po1"));

  expect(other.runs).toEqual([add("po1").call]);
});

it("a call whose --tab names another Tab than its Page Object Id's is refused, and no Run starts", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(shop);
  await session.ask({ pageObjects: {} });
  browser.give("po1");
  browser.openTab().show(signIn);

  expect(
    await session.ask({ call: { ...add("po1").call, tab: signIn.tab.url } })
  ).toEqual({
    ok: false,
    text: "po1 is a Page Object of the tab that shows http://127.0.0.1:5173/shop.html, not of the one that shows http://127.0.0.1:5173/sign-in.html. Leave out --tab: the Page Object Id chooses the tab.",
  });
  expect(
    await session.ask({ call: { ...add("po1").call, tab: shop.tab.url } })
  ).toMatchObject({ ok: true });
  expect(browser.runs).toHaveLength(1);
});
