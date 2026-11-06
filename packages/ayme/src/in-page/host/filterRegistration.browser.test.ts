import { describe, expect, it } from "vitest";

import { pageOfDocument } from "../../page-state/infrastructure";
import { ToolInputError, type ElementFilter } from "../../shared";
import { inPage } from "./inPage";
import { registerFilter, registerFilterThrough } from "./filterRegistration";

const registerFilterIn = (name: string, filter: ElementFilter) =>
  registerFilter(name, filter, document.documentElement);

/** Registers `filter` as a Node host does: asked through the slot's `check`. */
const registerFilterNode = (name: string, filter: ElementFilter) =>
  registerFilterThrough(
    (data) => inPage(pageOfDocument(document)).checkFilter(data),
    name,
    filter
  );

describe("registering an element filter", () => {
  it("refuses a function that closes over outer state, naming the identifier", async () => {
    const panelSelector = "#panel";
    let thrown: unknown;
    try {
      await registerFilterNode("`ignore`", (element: Element) =>
        element.matches(panelSelector)
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolInputError);
    expect((thrown as Error).message).toBe(
      "The `ignore` function reads `panelSelector`, which does not exist in the page. A filter function runs in the page on its own, so it cannot use variables from the code around it: pass a CSS selector, or move what it needs inside the function."
    );
  });

  it("refuses a native function, which the page cannot run", async () => {
    await expect(
      registerFilterNode("`ignore`", Math.max as never)
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("keeps a selector and a self-contained function as data", async () => {
    expect(await registerFilterNode("`ignore`", "#panel")).toEqual({
      selector: "#panel",
    });
    const data = await registerFilterNode("`ignore`", (element: Element) =>
      element.matches("[data-x]")
    );
    expect(data).toMatchObject({ source: expect.stringContaining("data-x") });
  });
});

describe("registering an element filter in the page's own realm", () => {
  it("throws the ToolInputError naming the identifier a function reads from the code around it", () => {
    const panelSelector = "#panel";
    expect(() =>
      registerFilterIn("`ignore`", (element: Element) =>
        element.matches(panelSelector)
      )
    ).toThrow(
      "The `ignore` function reads `panelSelector`, which does not exist in the page."
    );
  });

  it("keeps a selector and a self-contained function as data", () => {
    expect(registerFilterIn("`ignore`", "#panel")).toEqual({
      selector: "#panel",
    });
    expect(
      registerFilterIn("`ignore`", (element: Element) =>
        element.matches("[data-x]")
      )
    ).toMatchObject({ source: expect.stringContaining("data-x") });
  });
});
