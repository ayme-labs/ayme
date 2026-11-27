import { expect, it } from "vitest";

import type { TabDialog } from "../../session/domain";
import { DIALOG_OPEN_MS, tabDialogs } from "./tabDialogs";

const confirm = { type: "confirm", message: "Remove Milk?" };

/** A Tab's dialogs on a clock the test moves: `pass()` ends the wait the
 * dialog started, as if its time went by. */
function scripted() {
  const told: TabDialog[] = [];
  const waits: { ms: number; then: () => void; cancelled: boolean }[] = [];
  const dialogs = tabDialogs(
    (now) => told.push(now),
    (ms, then) => {
      const wait = { ms, then, cancelled: false };
      waits.push(wait);
      return () => (wait.cancelled = true);
    }
  );
  const pass = () => {
    const wait = waits.at(-1)!;
    if (!wait.cancelled) wait.then();
  };
  return { dialogs, told, waits, pass };
}

/** Starts an action whose code runs `body` inside the action, and returns
 * the action's promise and a function that ends it. */
function action(
  dialogs: ReturnType<typeof tabDialogs>,
  body: () => void = () => {}
) {
  let end = () => {};
  const ended = dialogs.actionCalls.run(
    () =>
      new Promise<void>((resolve) => {
        body();
        end = resolve;
      })
  );
  return { ended, end: () => end() };
}

/** A call the action makes later, inside its own async context, as a
 * Playwright call after an await. */
const later = (
  dialogs: ReturnType<typeof tabDialogs>,
  calls: Promise<unknown>[],
  answersAtOnce = false
) =>
  void Promise.resolve().then(() => {
    try {
      calls.push(Promise.resolve(dialogs.actionCalls.before(answersAtOnce)));
    } catch (error) {
      calls.push(Promise.reject(error));
    }
  });

const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => "started",
    (error: Error) => `refused: ${error.message}`
  );

async function pending(promise: Promise<unknown>) {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true)
  );
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  return !done;
}

const REFUSED =
  "refused: ayme refused this Playwright call: the action stopped at a dialog it did not answer itself.";

it("a dialog counts as open once it has stayed open for 100 ms, and is told so", () => {
  const { dialogs, told, waits, pass } = scripted();

  dialogs.opened(confirm);
  expect(told).toEqual(["opening"]);
  expect(waits.map(({ ms }) => ms)).toEqual([DIALOG_OPEN_MS]);
  expect(DIALOG_OPEN_MS).toBe(100);
  pass();
  expect(told).toEqual(["opening", { open: confirm }]);

  dialogs.closed();
  expect(told).toEqual(["opening", { open: confirm }, "none"]);
});

it("a dialog that closes within the 100 ms never counts as open", () => {
  const { dialogs, told, waits, pass } = scripted();

  dialogs.opened(confirm);
  dialogs.closed();
  pass();

  expect(told).toEqual(["opening", "none"]);
  expect(waits[0]!.cancelled).toBe(true);
});

it("while a dialog opens, an action's own call that reaches the browser waits, and starts when the dialog closes within the 100 ms", async () => {
  const { dialogs } = scripted();
  const calls: Promise<unknown>[] = [];
  action(dialogs, () => later(dialogs, calls));
  dialogs.opened(confirm);
  await Promise.resolve();
  await Promise.resolve();

  expect(await pending(calls[0]!)).toBe(true);
  dialogs.closed();

  expect(await settled(calls[0]!)).toBe("started");
});

it("once the dialog counts as open, the action's waiting call is refused", async () => {
  const { dialogs, pass } = scripted();
  const calls: Promise<unknown>[] = [];
  action(dialogs, () => later(dialogs, calls));
  dialogs.opened(confirm);
  await Promise.resolve();
  await Promise.resolve();

  pass();

  expect(await settled(calls[0]!)).toBe(REFUSED);
});

it("a stopped action's calls are refused after its dialog closed, those that answer at once too", async () => {
  const { dialogs, pass } = scripted();
  const late: Promise<unknown>[] = [];
  let answered = () => {};
  const dialogAnswered = new Promise<void>((resolve) => (answered = resolve));
  // The action goes on once its dialog is answered, as one blocked in a
  // page.evaluate does.
  action(
    dialogs,
    () =>
      void dialogAnswered.then(() => {
        later(dialogs, late);
        later(dialogs, late, true);
      })
  );
  dialogs.opened(confirm);
  pass();
  dialogs.closed();

  answered();
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();

  expect(await Promise.all(late.map(settled))).toEqual([REFUSED, REFUSED]);
});

it("a call outside every action, such as ayme's own read of the page, is neither held nor refused", () => {
  const { dialogs, pass } = scripted();
  action(dialogs);

  dialogs.opened(confirm);
  expect(dialogs.actionCalls.before(false)).toBeUndefined();
  pass();
  expect(dialogs.actionCalls.before(false)).toBeUndefined();
  expect(dialogs.actionCalls.before(true)).toBeUndefined();
});

it("an action that starts once a stopped action's dialog closed runs freely", async () => {
  const { dialogs, pass } = scripted();
  const stopped = action(dialogs);
  dialogs.opened(confirm);
  pass();
  dialogs.closed();
  stopped.end();
  await stopped.ended;

  const calls: Promise<unknown>[] = [];
  action(dialogs, () => later(dialogs, calls));
  await Promise.resolve();
  await Promise.resolve();

  expect(await settled(calls[0]!)).toBe("started");
});

it("an action whose call comes while a dialog counts as open is refused, though it started after the dialog counted", async () => {
  const { dialogs, pass } = scripted();
  dialogs.opened(confirm);
  pass();

  const calls: Promise<unknown>[] = [];
  action(dialogs, () => later(dialogs, calls));
  await Promise.resolve();
  await Promise.resolve();

  expect(await settled(calls[0]!)).toBe(REFUSED);
});

it("a call that answers at once is never held while a dialog opens", async () => {
  const { dialogs } = scripted();
  const calls: Promise<unknown>[] = [];
  action(dialogs, () => later(dialogs, calls, true));
  dialogs.opened(confirm);
  await Promise.resolve();
  await Promise.resolve();

  expect(await settled(calls[0]!)).toBe("started");
});
