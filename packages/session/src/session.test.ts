import { expect, it } from "vitest";

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
