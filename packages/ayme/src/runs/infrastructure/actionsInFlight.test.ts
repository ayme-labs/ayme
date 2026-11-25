import { expect, it } from "vitest";

import { actionsSettled, whileActing } from "./actionsInFlight";

const currentDocument = {} as Document;

function settledYet(promise: Promise<void>) {
  let settled = false;
  void promise.then(() => (settled = true));
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return settled;
  };
}

it("settles at once when no action is running", async () => {
  const settled = settledYet(actionsSettled(currentDocument));

  expect(await settled()).toBe(true);
});

it("settles once the running action ends", async () => {
  let end!: () => void;
  void whileActing(
    currentDocument,
    () => new Promise<void>((resolve) => (end = resolve))
  );
  const settled = settledYet(actionsSettled(currentDocument));

  expect(await settled()).toBe(false);
  end();
  expect(await settled()).toBe(true);
});

it("settles once a failed action has rejected", async () => {
  let fail!: (error: Error) => void;
  const failing = whileActing(
    currentDocument,
    () => new Promise<void>((_, reject) => (fail = reject))
  );
  failing.catch(() => {});
  const settled = settledYet(actionsSettled(currentDocument));

  fail(new Error("timed out"));

  expect(await settled()).toBe(true);
});

it("settles at once after an action that threw before it returned", async () => {
  expect(() =>
    whileActing(currentDocument, () => {
      throw new Error("no such element");
    })
  ).toThrow("no such element");
  const settled = settledYet(actionsSettled(currentDocument));

  expect(await settled()).toBe(true);
});

it("settles once every overlapping action has ended", async () => {
  const ends: (() => void)[] = [];
  const act = () =>
    void whileActing(
      currentDocument,
      () => new Promise<void>((resolve) => ends.push(resolve))
    );
  act();
  act();
  const settled = settledYet(actionsSettled(currentDocument));

  ends[0]!();
  expect(await settled()).toBe(false);
  ends[1]!();
  expect(await settled()).toBe(true);
});
