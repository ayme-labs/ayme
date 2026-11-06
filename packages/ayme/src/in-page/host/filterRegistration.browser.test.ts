import { describe, expect, it } from "vitest";

import { ToolInputError } from "../../shared";
import { registerFilter } from "./filterRegistration";

describe("registering an element filter", () => {
  it("refuses a function that closes over outer state, naming the identifier", () => {
    const panelSelector = "#panel";
    let thrown: unknown;
    try {
      registerFilter("`ignore`", (element) => element.matches(panelSelector));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolInputError);
    expect((thrown as Error).message).toBe(
      "The `ignore` function reads `panelSelector`, which does not exist in the page. A filter function runs in the page on its own, so it cannot use variables from the code around it: pass a CSS selector, or move what it needs inside the function."
    );
  });

  it("refuses a native function, which the page cannot run", () => {
    expect(() => registerFilter("`ignore`", Math.max as never)).toThrow(
      ToolInputError
    );
  });

  it("keeps a selector and a self-contained function as data", () => {
    expect(registerFilter("`ignore`", "#panel")).toEqual({
      selector: "#panel",
    });
    const data = registerFilter("`ignore`", (element) =>
      element.matches("[data-x]")
    );
    expect(data).toMatchObject({ source: expect.stringContaining("data-x") });
  });
});
