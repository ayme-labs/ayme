import { describe, expect, it } from "vitest";

import { ToolInputError } from "../../shared";
import { registerFilterThrough } from "./filterRegistration";

describe("registering a filter through a remote host on a page that forbids eval", () => {
  const noEval = () => Promise.resolve({ kind: "no-eval" } as const);

  it("rejects a function, which cannot cross to the page, recommending a CSS selector", async () => {
    const thrown = await registerFilterThrough(noEval, "`ignore`", () => true)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ToolInputError);
    expect((thrown as Error).message).toContain("`ignore`");
    expect((thrown as Error).message).toContain("CSS selector");
  });
});
