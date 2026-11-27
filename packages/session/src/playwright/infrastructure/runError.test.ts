import { expect, it } from "vitest";

import { RunError } from "../../session/domain";
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
