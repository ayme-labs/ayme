import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Each test gets a fresh module: an action that never settles would otherwise
// stay counted for the tests after it.
let inFlight: typeof import("./actionsInFlight");
const currentDocument = {} as Document;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  inFlight = await import("./actionsInFlight");
});

afterEach(() => {
  vi.useRealTimers();
});

function settledYet(promise: Promise<void>) {
  let settled = false;
  void promise.then(() => (settled = true));
  return async () => {
    await vi.advanceTimersByTimeAsync(0);
    return settled;
  };
}

it("settles at once when no action is running", async () => {
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  expect(await settled()).toBe(true);
});

it("settles once the running action ends", async () => {
  let end!: () => void;
  void inFlight.whileActing(
    currentDocument,
    () => new Promise<void>((resolve) => (end = resolve))
  );
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  expect(await settled()).toBe(false);
  end();
  expect(await settled()).toBe(true);
});

it("settles once a failed action has rejected", async () => {
  let fail!: (error: Error) => void;
  const failing = inFlight.whileActing(
    currentDocument,
    () => new Promise<void>((_, reject) => (fail = reject))
  );
  failing.catch(() => {});
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  fail(new Error("timed out"));

  expect(await settled()).toBe(true);
});

it("settles at once after an action that threw before it returned", async () => {
  expect(() =>
    inFlight.whileActing(currentDocument, () => {
      throw new Error("no such element");
    })
  ).toThrow("no such element");
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  expect(await settled()).toBe(true);
});

it("settles once every overlapping action has ended", async () => {
  const ends: (() => void)[] = [];
  const act = () =>
    void inFlight.whileActing(
      currentDocument,
      () => new Promise<void>((resolve) => ends.push(resolve))
    );
  act();
  act();
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  ends[0]!();
  expect(await settled()).toBe(false);
  ends[1]!();
  expect(await settled()).toBe(true);
});

it("settles after its limit when an action never ends", async () => {
  void inFlight.whileActing(currentDocument, () => new Promise<void>(() => {}));
  const settled = settledYet(inFlight.actionsSettled(currentDocument));

  await vi.advanceTimersByTimeAsync(inFlight.ACTIONS_SETTLED_LIMIT_MS - 1);
  expect(await settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await settled()).toBe(true);
});
