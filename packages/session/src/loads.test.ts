import { expect, it } from "vitest";

import { ActionNotStarted, RunError } from "./session/domain";
import { DESTROYED, startScriptedSession } from "../testing";

// A page that starts loading a new document while ayme reads it, as after a
// sign-in, through the Session's interface on the scripted browser.

const opening = { open: { headed: false } } as const;

const SIGN_IN = "http://127.0.0.1:5173/sign-in";
const DASHBOARD = "http://127.0.0.1:5173/dashboard";
const LOADING = `The page started loading ${DASHBOARD} while ayme read it. Wait for the load with your browser automation, then run this command again.`;

const signIn = {
  tab: { url: SIGN_IN, title: "Sign in" },
  pageObjectTree: "SignInPage",
  tools: [],
};

it.each([
  ["page-objects", { pageObjects: {} }],
  ["tools", { tools: {} }],
] as const)(
  "%s whose read the Tab's new document cut short says the page started loading it, after the Tab line, and the next listing reads the new page",
  async (_, request) => {
    const { session, browser } = await startScriptedSession(opening);
    browser.show(signIn);
    browser.holdReads();

    const answer = session.ask(request);
    await browser.until(() => browser.listingsRead === 1);
    browser.load(DASHBOARD);

    expect(await answer).toEqual({
      ok: false,
      text: `Tab t1: ${DASHBOARD}\n${LOADING}`,
    });
    expect(await session.ask(request)).toMatchObject({ ok: true });
  }
);

it("a read that fails on the document it began on keeps its sentence, also after an earlier load", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.load(DASHBOARD);
  browser.failReads(DESTROYED);

  expect(await session.ask({ pageObjects: {} })).toEqual({
    ok: false,
    text: DESTROYED,
  });
});

it("a call whose read before its action the Tab's new document cut short says the page started loading it", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(signIn);
  browser.answerRuns(async () => {
    browser.load(DASHBOARD);
    throw new ActionNotStarted(
      "page.evaluate: Execution context was destroyed, most likely because of a navigation"
    );
  });

  expect(
    await session.ask({ call: { tool: "SignInPage.submit", input: {} } })
  ).toEqual({ ok: false, text: LOADING });
});

it("a call that failed once its action started keeps its error, though a new document started: the action may have changed the page", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.show(signIn);
  browser.answerRuns(async () => {
    browser.load(DASHBOARD);
    throw new RunError(
      "page.evaluate: Execution context was destroyed, most likely because of a navigation"
    );
  });

  expect(
    await session.ask({ call: { tool: "SignInPage.submit", input: {} } })
  ).toEqual({
    ok: false,
    text: "page.evaluate: Execution context was destroyed, most likely because of a navigation",
  });
});

it("a call that failed before its action on the document it began on keeps its error", async () => {
  const { session, browser } = await startScriptedSession(opening);
  browser.answerRuns(async () => {
    throw new ActionNotStarted("Page Object po1 is not on the page.");
  });

  expect(
    await session.ask({ call: { tool: "Basket.add", input: { id: "po1" } } })
  ).toEqual({ ok: false, text: "Page Object po1 is not on the page." });
});
