import type { Page } from "@playwright/test";
import { expect, it } from "vitest";

import type { Caller } from "../../shared";
import { runLogOf } from "./runLog";

const by = "ayme-command" as Caller;

it("records a Run its Host stopped as failed with why at once, and not what it answers later", async () => {
  const log = runLogOf({} as Page);
  let stop: (why: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => (stop = reject));
  let answer: (value: string) => void = () => {};
  const answered = new Promise<string>((resolve) => (answer = resolve));

  const run = log.record("Cart.add", {}, { by }, () => answered, { stopped });
  stop(new Error("A dialog is open."));
  await Promise.resolve();

  expect(log.list()).toMatchObject([
    { tool: "Cart.add", status: "failed", error: "A dialog is open." },
  ]);

  answer("added");
  await run;

  expect(log.list()).toMatchObject([
    { status: "failed", error: "A dialog is open." },
  ]);
  expect(log.list()[0]).not.toHaveProperty("result");
});
