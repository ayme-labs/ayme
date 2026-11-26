import { expect, it } from "vitest";

import { startScriptedSession } from "../testing";
import { unknownRequest } from "./session/domain";

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

  // A kind of request the Session does not have yet waits as every request
  // but stop does.
  const answer = session.ask({ later: {} } as never);
  expect(await pending(answer)).toBe(true);
  browser.open();

  expect(await answer).toEqual(unknownRequest);
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
  const waiting = session.ask({ later: {} } as never);

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
  const waiting = session.ask({ later: {} } as never);

  browser.failOpen("Playwright could not open Chromium.");

  const why = { ok: false, text: "Playwright could not open Chromium." };
  expect(await session.started).toEqual(why);
  expect(await waiting).toEqual(why);
  expect(await session.ask({ stop: {} })).toEqual(why);
  expect(await session.ended).toBe("start failed");
});
