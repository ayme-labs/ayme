import { afterEach, describe, expect, it } from "vitest";

import {
  isCheckableElement,
  isClickableElement,
  isFillableElement,
  isSelectElement,
  isUncheckableElement,
} from "./elementFilters";

describe("Browser Tool element filters, in Chromium", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function fixture(html: string): Element {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild;
    if (!element) throw new Error("Expected a fixture element.");
    return element;
  }

  it("keeps elements with an interactive role for click", () => {
    expect(isClickableElement(fixture("<button>Save</button>"))).toBe(true);
    expect(isClickableElement(fixture('<a href="/next">Next</a>'))).toBe(true);
    expect(isClickableElement(fixture('<div role="button">Go</div>'))).toBe(
      true
    );
  });

  it("keeps elements with a pointer cursor for click", () => {
    expect(
      isClickableElement(fixture('<div style="cursor: pointer">Card</div>'))
    ).toBe(true);
  });

  it("drops plain and disabled elements for click", () => {
    expect(isClickableElement(fixture("<p>Just text</p>"))).toBe(false);
    expect(isClickableElement(fixture("<button disabled>Save</button>"))).toBe(
      false
    );
    expect(
      isClickableElement(fixture('<button aria-disabled="true">Save</button>'))
    ).toBe(false);
    expect(
      isClickableElement(
        fixture('<a role="button" style="cursor: pointer">No href</a>')
      )
    ).toBe(true);
  });

  it("keeps elements that can actually be filled", () => {
    expect(isFillableElement(fixture('<input aria-label="Name">'))).toBe(true);
    expect(
      isFillableElement(fixture('<input type="email" aria-label="Mail">'))
    ).toBe(true);
    expect(isFillableElement(fixture('<textarea aria-label="Note">'))).toBe(
      true
    );
    expect(
      isFillableElement(fixture('<div contenteditable="true">Text</div>'))
    ).toBe(true);
    expect(
      isFillableElement(
        fixture('<div contenteditable="plaintext-only">Text</div>')
      )
    ).toBe(true);
  });

  it("keeps exactly the input types Playwright fills", () => {
    const fillable = (type: string) =>
      isFillableElement(fixture(`<input type="${type}">`));
    expect(
      [
        "color",
        "date",
        "datetime-local",
        "email",
        "month",
        "number",
        "password",
        "range",
        "search",
        "tel",
        "text",
        "time",
        "url",
        "week",
      ].filter((type) => !fillable(type))
    ).toEqual([]);
    expect(
      [
        "button",
        "checkbox",
        "file",
        "hidden",
        "image",
        "radio",
        "reset",
        "submit",
      ].filter(fillable)
    ).toEqual([]);
  });

  it("drops elements that cannot be filled", () => {
    expect(isFillableElement(fixture("<button>Save</button>"))).toBe(false);
    expect(
      isFillableElement(fixture('<input type="checkbox" aria-label="Done">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input readonly aria-label="Name">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input disabled aria-label="Name">'))
    ).toBe(false);
  });

  it("keeps checkboxes and radio buttons for check and uncheck", () => {
    expect(isCheckableElement(fixture('<input type="checkbox">'))).toBe(true);
    expect(isCheckableElement(fixture('<input type="radio">'))).toBe(true);
    expect(isCheckableElement(fixture('<div role="switch">On</div>'))).toBe(
      true
    );
    expect(isCheckableElement(fixture('<input type="text">'))).toBe(false);
    expect(
      isCheckableElement(fixture('<input type="checkbox" disabled>'))
    ).toBe(false);
  });

  it("keeps checkboxes but not radio buttons for uncheck", () => {
    expect(isUncheckableElement(fixture('<input type="checkbox">'))).toBe(true);
    expect(isUncheckableElement(fixture('<input type="radio">'))).toBe(false);
  });

  it("keeps select elements for select_option", () => {
    expect(
      isSelectElement(fixture("<select><option>A</option></select>"))
    ).toBe(true);
    expect(
      isSelectElement(fixture("<select disabled><option>A</option></select>"))
    ).toBe(false);
    expect(isSelectElement(fixture('<div role="combobox">A</div>'))).toBe(
      false
    );
  });
});
