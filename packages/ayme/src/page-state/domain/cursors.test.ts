import { expect, it } from "vitest";

import { createCursors, movesUntil } from "./cursors";
import type { StructuralObservationEntry } from "@ayme-dev/core/structural-observation";

const entry = (id: string) => ({ id }) as unknown as StructuralObservationEntry;

it("a stopped Run's cursor moves its Caller's no more: its Caller never received what the Run read", async () => {
  const caller = createCursors().of("ayme-command");
  let stop = () => {};
  const stopped = new Promise<never>(
    (_, reject) => (stop = () => reject(new Error("stopped")))
  );
  const run = movesUntil(caller, stopped);

  run.move(entry("before"));
  stop();
  await stopped.catch(() => {});
  run.move(entry("after"));

  expect(caller.current()).toEqual(entry("before"));
  expect(run.current()).toEqual(entry("before"));
});
