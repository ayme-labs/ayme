import { afterEach, expect, it } from "vitest";

import { failingOnItsUncaught, failItsRun, LeftUncaught } from "./runUncaught";

// Stands in for the process's handlers of what nothing caught, which run in
// the context of the code that threw.
const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(() => timers.splice(0).forEach(clearTimeout));

it("fails a Run with an error that code it started reports from a timer, before the Run settles", async () => {
  const error = new Error("The timer failed.");

  const run = failingOnItsUncaught(
    () =>
      new Promise<never>(() => {
        timers.push(setTimeout(() => failItsRun(error)));
      })
  );

  await expect(run).rejects.toMatchObject({ error });
});

it("tells, with the error, when the work of the Run it failed early ends", async () => {
  let end!: () => void;
  const run = failingOnItsUncaught(
    () =>
      new Promise<void>((resolve) => {
        end = resolve;
        timers.push(
          setTimeout(() => failItsRun(new Error("The timer failed.")))
        );
      })
  );

  const failed = await run.catch((error: unknown) => error);
  expect(failed).toBeInstanceOf(LeftUncaught);
  let ended = false;
  void (failed as LeftUncaught).ended.then(() => (ended = true));
  await new Promise((resolve) => setTimeout(resolve));
  expect(ended).toBe(false);
  end();
  await (failed as LeftUncaught).ended;
});

it("fails a Run that fails by itself with its own error", async () => {
  const error = new Error("The action failed.");
  await expect(failingOnItsUncaught(() => Promise.reject(error))).rejects.toBe(
    error
  );
});

it("leaves a Run that has settled, and another Run under way, as they are", async () => {
  const first = failingOnItsUncaught(async () => {
    // Reports once the first Run has settled and the second is under way.
    timers.push(setTimeout(() => failItsRun(new Error("Too late.")), 10));
    return "first";
  });
  await expect(first).resolves.toBe("first");

  const second = failingOnItsUncaught(
    () =>
      new Promise<string>((resolve) => {
        timers.push(setTimeout(() => resolve("second"), 30));
      })
  );

  await expect(second).resolves.toBe("second");
});

it("fails no Run with an error from outside every Run", () => {
  expect(() => failItsRun(new Error("Nobody's."))).not.toThrow();
});
