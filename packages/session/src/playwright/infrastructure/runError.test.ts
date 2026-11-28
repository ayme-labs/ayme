import { expect, it } from "vitest";

import { ActionNotStarted, RunError } from "../../session/domain";
import { runErrorOf } from "./runError";
import { LeftUncaught } from "./runUncaught";

/** An error as the project's @ayme-dev/ayme throws it, of a class of its
 * own copy. */
function thrown(name: string, message: string, changes?: string): Error {
  const error = new Error(message);
  error.name = name;
  return changes === undefined ? error : Object.assign(error, { changes });
}

it("tells a refusal as an agent reads it today: the error's name, then its message", () => {
  expect(
    runErrorOf(thrown("ToolInputError", "Input property id is required."))
  ).toEqual(new RunError("ToolInputError: Input property id is required."));
});

it("tells an error Page Object code threw by its message alone when it is a plain Error", () => {
  expect(runErrorOf(new Error("The basket is locked."))).toEqual(
    new RunError("The basket is locked.")
  );
});

it("keeps how the Page Object Tree changed while the failed Run ran", () => {
  const error = runErrorOf(
    thrown("TimeoutError", "Timeout 30000ms exceeded.", "Basket po1")
  );

  expect([error.message, error.changes]).toEqual([
    "TimeoutError: Timeout 30000ms exceeded.",
    "Basket po1",
  ]);
});

it.each([
  ["empty", ""],
  ["no text", 3],
])(
  "tells no change of the Page Object Tree when the error's changes are %s",
  (_, changes) => {
    const error = Object.assign(new Error("The basket is locked."), {
      changes,
    });

    expect(runErrorOf(error).changes).toBeUndefined();
  }
);

it("tells a thrown value that is no Error as text", () => {
  expect(runErrorOf("closed")).toEqual(new RunError("closed"));
});

it("tells an error the Run's code left uncaught as it tells any, with the Run's work still going", () => {
  const ended = new Promise<void>(() => {});
  const error = runErrorOf(
    new LeftUncaught(thrown("TypeError", "x is not a function"), ended)
  );

  expect([error.message, error.going]).toEqual([
    "TypeError: x is not a function",
    ended,
  ]);
});

it("tells a Run that failed before its action started apart, with the same message and changes", () => {
  const error = runErrorOf(
    thrown("Error", "Execution context was destroyed.", "Basket po1"),
    false
  );

  expect(error).toBeInstanceOf(ActionNotStarted);
  expect([error.message, error.changes]).toEqual([
    "Execution context was destroyed.",
    "Basket po1",
  ]);
  expect(runErrorOf(new Error("x"))).not.toBeInstanceOf(ActionNotStarted);
});

it("tells an error left uncaught before the Run's action started apart too", () => {
  const error = runErrorOf(
    new LeftUncaught(new Error("x"), Promise.resolve()),
    false
  );

  expect(error).toBeInstanceOf(ActionNotStarted);
});
