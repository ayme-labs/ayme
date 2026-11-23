import type { ChangeRow } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import {
  chipText,
  changeTitle,
  effectOf,
  groupEffect,
  groupText,
} from "./changeWording";

// How the window says what changed: the released recorder's wording is the
// baseline. A property it has no wording for still says something true.

const changed = (
  ...changes: { property: string; from?: string; to?: string }[]
): ChangeRow => ({
  kind: "changed",
  element: 'textbox "Username"',
  changed: changes,
});

describe("what a change row says happened", () => {
  it("says an element appeared or was removed", () => {
    expect(effectOf({ kind: "added", element: 'button "Remove"' })).toBe(
      "appeared"
    );
    expect(effectOf({ kind: "removed", element: 'button "Add"' })).toBe(
      "was removed"
    );
  });

  it("says how its text changed, from empty or to empty", () => {
    expect(effectOf(changed({ property: "text", to: "secret_sauce" }))).toBe(
      "text changed from empty to “secret_sauce”"
    );
    expect(
      effectOf(changed({ property: "text", from: "Items: 1", to: "Items: 2" }))
    ).toBe("text changed from “Items: 1” to “Items: 2”");
    expect(effectOf(changed({ property: "text", from: "Saved" }))).toBe(
      "text changed from “Saved” to empty"
    );
    // An empty value reads as none at all.
    expect(effectOf(changed({ property: "text", from: "", to: "1" }))).toBe(
      "text changed from empty to “1”"
    );
    expect(effectOf(changed({ property: "/url", from: "/cart", to: "" }))).toBe(
      "url changed from “/cart” to empty"
    );
  });

  it("says how its name or its role changed", () => {
    expect(
      effectOf(
        changed({ property: "name", from: "Cart, empty", to: "Cart, 1 items" })
      )
    ).toBe("name changed from “Cart, empty” to “Cart, 1 items”");
    expect(
      effectOf(changed({ property: "role", from: "button", to: "link" }))
    ).toBe("role changed from button to link");
  });

  it.each([
    ["active", "became active", "active state was cleared"],
    ["checked", "became checked", "checked state was cleared"],
    ["disabled", "became disabled", "disabled state was cleared"],
    ["expanded", "became expanded", "expanded state was cleared"],
    ["selected", "became selected", "selected state was cleared"],
    ["pressed", "became pressed", "pressed state was cleared"],
  ])("says the state %s was set or cleared", (state, set, cleared) => {
    expect(effectOf(changed({ property: state, to: "true" }))).toBe(set);
    expect(effectOf(changed({ property: state, from: "true" }))).toBe(cleared);
  });

  it("says a state became mixed", () => {
    expect(effectOf(changed({ property: "checked", to: "mixed" }))).toBe(
      "became partially checked"
    );
    expect(
      effectOf(changed({ property: "pressed", from: "true", to: "mixed" }))
    ).toBe("became partially pressed");
  });

  it("says how a heading's level changed", () => {
    expect(effectOf(changed({ property: "level", from: "1", to: "2" }))).toBe(
      "level changed from 1 to 2"
    );
    expect(effectOf(changed({ property: "level", to: "3" }))).toBe(
      "level changed from none to 3"
    );
  });

  it("says it became clickable, or no longer is", () => {
    expect(effectOf(changed({ property: "cursor", to: "pointer" }))).toBe(
      "became clickable"
    );
    expect(effectOf(changed({ property: "cursor", from: "pointer" }))).toBe(
      "is no longer clickable"
    );
  });

  it("says how one of its properties changed, by its name", () => {
    expect(
      effectOf(changed({ property: "/url", from: "/cart", to: "/checkout" }))
    ).toBe("url changed from “/cart” to “/checkout”");
  });

  it("says something true of a property it has no words for", () => {
    expect(effectOf(changed({ property: "busy", from: "x", to: "y" }))).toBe(
      "busy changed from “x” to “y”"
    );
    // Only a slash before a property's name is left out.
    expect(effectOf(changed({ property: "aria/x", from: "a", to: "b" }))).toBe(
      "aria/x changed from “a” to “b”"
    );
  });

  it("says each of several changes, in their order", () => {
    expect(
      effectOf(
        changed(
          { property: "text", from: "a", to: "b" },
          { property: "active", to: "true" }
        )
      )
    ).toBe("text changed from “a” to “b”, became active");
  });

  it("says it changed when no property it names changed", () => {
    expect(effectOf({ kind: "changed", element: "list", changed: [] })).toBe(
      "changed"
    );
    expect(effectOf({ kind: "changed", element: "list" })).toBe("changed");
  });
});

describe("an element chip", () => {
  it("names the element by its role and name, in curly quotes", () => {
    expect(chipText('textbox "Username"')).toBe("textbox “Username”");
    expect(chipText('button "View details for \\"Backpack\\""')).toBe(
      'button “View details for "Backpack"”'
    );
    expect(chipText("navigation")).toBe("navigation");
  });

  it("puts each quoted part of a label in curly quotes: the text inside, an ancestor, a place", () => {
    expect(
      chipText('listitem "buy milk" › checkbox "Toggle Todo" (2nd of 3)')
    ).toBe("listitem “buy milk” › checkbox “Toggle Todo” (2nd of 3)");
    expect(chipText('"1 items left"')).toBe("“1 items left”");
  });
});

describe("a row that folds elements of one role", () => {
  const into = (kind: "added" | "removed"): ChangeRow => ({
    kind,
    element: 'listitem "x"',
  });

  it("names how many elements of which role it folds", () => {
    expect(groupText("listitem", 30)).toBe("30 listitems");
    expect(groupText("textbox", 3)).toBe("3 textboxes");
  });

  it("says how many were removed from and how many appeared in their parent, removed first, as the released window does", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => into("added")),
      ...Array.from({ length: 25 }, () => into("removed")),
    ];
    expect(groupEffect(rows, "Issues")).toBe(
      "25 removed from, 5 appeared in “Issues”"
    );
  });

  it("says only where they went when they all went the same way", () => {
    expect(groupEffect([into("removed"), into("removed")], "Issues")).toBe(
      "removed from “Issues”"
    );
    expect(groupEffect([into("added"), into("added")], "Issues")).toBe(
      "appeared in “Issues”"
    );
  });
});

describe("the title of a change no Interaction made", () => {
  const added: ChangeRow = { kind: "added", element: "dialog" };
  const removed: ChangeRow = { kind: "removed", element: "alert" };

  it("says how many elements appeared, or were removed, when that is all", () => {
    expect(changeTitle([added])).toBe("Element appeared");
    expect(changeTitle([added, added, added])).toBe("3 elements appeared");
    expect(changeTitle([removed])).toBe("Element removed");
    expect(changeTitle([removed, removed])).toBe("2 elements removed");
  });

  it("counts every element, folded or not, and none whose only change is the cursor", () => {
    const cursor: ChangeRow = {
      kind: "changed",
      element: 'button "Pay"',
      changed: [{ property: "cursor", to: "pointer" }],
    };
    expect(changeTitle([added, cursor, added, added])).toBe(
      "3 elements appeared"
    );
  });

  it("says the UI changed otherwise", () => {
    expect(changeTitle([added, removed])).toBe("UI Changed");
    expect(changeTitle([changed({ property: "active", to: "true" })])).toBe(
      "UI Changed"
    );
    expect(changeTitle([])).toBe("UI Changed");
  });
});
