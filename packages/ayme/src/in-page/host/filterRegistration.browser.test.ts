import { describe, expect, it } from "vitest";

import { pageOfDocument } from "../../page-state/infrastructure";
import { ToolInputError } from "../../shared";
import { inPage } from "./inPage";
import { registerFilter, registerFilterThrough } from "./filterRegistration";

const page = () => pageOfDocument(document);

/** Registers `selector` in the page's own realm, as the browser runtime does. */
const registerIn = (selector: string) =>
  registerFilter("`ignore`", selector, {
    page: page(),
    root: document.documentElement,
  });

/** Registers `selector` as a Node host does: asked through the slot's `check`. */
const registerThrough = (selector: string) =>
  registerFilterThrough(
    (filter) => inPage(page()).checkFilter(filter),
    "`ignore`",
    selector,
    page()
  );

describe("registering a selector filter", () => {
  it("keeps a selector as data, in the page's realm and through the slot's check", async () => {
    expect(registerIn("#panel")).toEqual({ selector: "#panel" });
    expect(await registerThrough("#panel")).toEqual({ selector: "#panel" });
  });

  it("refuses a selector that does not parse with a ToolInputError naming the registration, either way", async () => {
    expect(() => registerIn("[[")).toThrow(ToolInputError);
    expect(() => registerIn("[[")).toThrow(
      "The `ignore` is not a valid CSS selector:"
    );
    await expect(registerThrough("[[")).rejects.toThrow(
      "The `ignore` is not a valid CSS selector:"
    );
  });
});
