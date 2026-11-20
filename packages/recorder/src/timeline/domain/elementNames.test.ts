import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { describe, expect, it } from "vitest";

import {
  labelNear,
  labelOf,
  selectorWords,
  type PageView,
} from "./elementNames";

const read = (yaml: string, refs = new SyntheticAriaRefFactory()) =>
  StructuralTree.fromAriaSnapshotYaml(yaml, refs);

/** An element's label and selector, by its ref. */
function label(tree: StructuralTree, ref: string, view: PageView = "after") {
  const named = labelOf(tree, tree.getNode(ref as AriaRef)!, view);
  return named && { label: named.label, selector: named.selector };
}

/** A to-do list as Playwright's AI-mode snapshot writes it. */
const todos = (...items: string[]) =>
  [
    `- generic [ref=e1]:`,
    `  - heading "todos" [level=1] [ref=e2]`,
    `  - list [ref=e3]:`,
    ...items.flatMap((item, at) => [
      `    - listitem [ref=e${10 + 2 * at}]:`,
      `      - checkbox "Toggle Todo" [ref=e${11 + 2 * at}]`,
      `      - text: ${item}`,
      // The delete button's icon, drawn by a style: no text of the page's.
      `      - text: ×`,
    ]),
    `  - generic [ref=e4]:`,
    `    - strong [ref=e5]: "${items.length}"`,
    `    - text: items left`,
  ].join("\n");

describe("the label of an element", () => {
  it("is its role and name when no other element of the page has both", () => {
    const tree = read(todos("buy milk", "feed the cat"));

    expect(label(tree, "e2")).toEqual({
      label: 'heading "todos"',
      selector: 'internal:role=heading[name="todos"s]',
    });
  });

  it("adds the text inside it, quoted, when others have its role and name", () => {
    const tree = read(todos("buy milk", "feed the cat", "call mum"));

    expect(label(tree, "e12")).toEqual({
      label: 'listitem "feed the cat"',
      selector: 'internal:role=listitem >> internal:has-text="feed the cat"i',
    });
  });

  it("is written inside its nearest ancestor whose label is the page's only one, when the text inside does not tell it apart", () => {
    const tree = read(todos("buy milk", "feed the cat", "call mum"));

    expect(label(tree, "e13")).toEqual({
      label: 'listitem "feed the cat" › checkbox "Toggle Todo"',
      selector:
        'internal:role=listitem >> internal:has-text="feed the cat"i >> internal:role=checkbox[name="Toggle Todo"s]',
    });
  });

  it("gives its place among its look-alikes, as a last resort", () => {
    const tree = read(todos("buy milk", "buy milk", "call mum"));

    expect(label(tree, "e12")).toEqual({
      label: 'listitem "buy milk" (2nd of 2)',
      selector:
        'internal:role=listitem >> internal:has-text="buy milk"i >> nth=1',
    });
    // Its listitem fits two, and the list holds three like it.
    expect(label(tree, "e13")).toEqual({
      label: 'checkbox "Toggle Todo" (2nd of 3)',
      selector: 'internal:role=checkbox[name="Toggle Todo"s] >> nth=1',
    });
  });

  it("is the text inside it alone, for an element with no role and no name", () => {
    const tree = read(todos("buy milk"));

    expect(label(tree, "e4")).toEqual({
      label: '"items left"',
      selector: 'internal:text="items left"i',
    });
  });

  it("quotes the longest text piece inside it: one text of the page's, never pieces joined", () => {
    const tree = read(todos("buy milk", "feed the cat"));

    // Not "buy milk ×": the icon is no text of the page's own.
    expect(label(tree, "e10")?.label).toBe('listitem "buy milk"');
  });

  it("is its role and its text, for an element with nothing but text inside it", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - paragraph [ref=e2]: Saved`,
        `  - generic [ref=e3]: Draft`,
      ].join("\n")
    );

    expect(label(tree, "e2")).toEqual({
      label: 'paragraph "Saved"',
      selector: 'internal:role=paragraph >> internal:has-text="Saved"s',
    });
    expect(label(tree, "e3")).toEqual({
      label: '"Draft"',
      selector: 'internal:text="Draft"s',
    });
  });

  it("shortens long text inside at a word, and looks for what it kept", () => {
    const tree = read(
      todos(
        "write the quarterly report for the board meeting on Friday",
        "call mum"
      )
    );

    expect(label(tree, "e10")).toEqual({
      label: 'listitem "write the quarterly report for the board…"',
      selector:
        'internal:role=listitem >> internal:has-text="write the quarterly report for the board"i',
    });
  });

  it("escapes quotes in its words and its selector", () => {
    const tree = read(
      [`- generic [ref=e1]:`, `  - button "Say \\"hi\\"" [ref=e2]`].join("\n")
    );

    expect(label(tree, "e2")).toEqual({
      label: 'button "Say \\"hi\\""',
      selector: 'internal:role=button[name="Say \\"hi\\""s]',
    });
  });

  it("enters the frame it is in, by the frame's own label", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - button "Twin" [ref=e2]`,
        `  - iframe [ref=e3]:`,
        `    - button "Pay" [ref=f1e1]`,
        `    - button "Twin" [ref=f1e2]`,
      ].join("\n")
    );

    expect(label(tree, "f1e1")).toEqual({
      label: 'button "Pay"',
      selector:
        'iframe >> internal:control=enter-frame >> internal:role=button[name="Pay"s]',
    });
    // Its selector matches in the frame's document only: there it is the
    // one "Twin".
    expect(label(tree, "f1e2")).toEqual({
      label: 'button "Twin"',
      selector:
        'iframe >> internal:control=enter-frame >> internal:role=button[name="Twin"s]',
    });
  });

  it("counts against the page after a change for what appeared, and before it for what was removed", () => {
    const refs = new SyntheticAriaRefFactory();
    const change = StructuralTree.reconcile(
      read(
        [
          `- generic [ref=e1]:`,
          `  - button "Undo" [ref=e2]`,
          `  - list [ref=e3]:`,
          `    - listitem [ref=e4]: buy milk`,
        ].join("\n"),
        refs
      ),
      read(
        [
          `- generic [ref=e1]:`,
          `  - list [ref=e3]:`,
          `    - listitem [ref=e4]: buy milk`,
          `    - listitem [ref=e5]: buy milk`,
          `  - dialog "Saved" [ref=e6]:`,
          `    - button "Undo" [ref=e7]`,
        ].join("\n"),
        refs
      )
    );

    // Each "Undo" is the only one on its page.
    expect(label(change, "e2", "before")?.label).toBe('button "Undo"');
    expect(label(change, "e7", "after")?.label).toBe('button "Undo"');
    // The listitem that appeared has a look-alike on the page after.
    expect(label(change, "e5", "after")?.label).toBe(
      'listitem "buy milk" (2nd of 2)'
    );
    // Before, the first one was the only one.
    expect(label(change, "e4", "before")?.label).toBe('listitem "buy milk"');
  });

  it("is of the text a changed element had before, on the page before", () => {
    const refs = new SyntheticAriaRefFactory();
    const count = (left: string) =>
      [
        `- generic [ref=e1]:`,
        `  - generic [ref=e4]:`,
        `    - strong [ref=e5]: "1"`,
        `    - text: ${left}`,
      ].join("\n");
    const change = StructuralTree.reconcile(
      read(count("item left"), refs),
      read(count("items left"), refs)
    );

    expect(label(change, "e4", "before")?.label).toBe('"item left"');
    expect(label(change, "e4", "after")?.label).toBe('"items left"');
  });
});

// A label fits exactly the element it names as its own selector matches,
// by Playwright's rules: a role's name and a text exact where the selector
// says so, the text inside as part of a text in any case, a role alone any
// element of that role; and its place counts what that selector matches.
describe("the label of an element, as its selector matches", () => {
  it("names an element with nothing but text inside it by that text exactly, so it fits no element whose text only holds it", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - paragraph [ref=e2]: Saved`,
        `  - paragraph [ref=e3]: Not saved`,
      ].join("\n")
    );

    expect(label(tree, "e2")).toEqual({
      label: 'paragraph "Saved"',
      selector: 'internal:role=paragraph >> internal:has-text="Saved"s',
    });
  });

  it("counts every element whose text holds the text inside, in any case, and gives the place among those", () => {
    const tree = read(todos("Buy milk today", "buy milk", "buy milk"));

    expect(label(tree, "e10")?.label).toBe('listitem "Buy milk today"');
    expect(label(tree, "e14")).toEqual({
      label: 'listitem "buy milk" (3rd of 3)',
      selector:
        'internal:role=listitem >> internal:has-text="buy milk"i >> nth=2',
    });
  });

  it("counts every element of a role for a role alone, named or not", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - list [ref=e2]:`,
        `    - listitem [ref=e3]:`,
        `      - checkbox "Done" [ref=e4]`,
        `    - listitem "Shipping" [ref=e5]`,
      ].join("\n")
    );

    expect(label(tree, "e3")).toEqual({
      label: "listitem (1st of 2)",
      selector: "internal:role=listitem >> nth=0",
    });
  });

  it("counts an element with no role by its text as Playwright's text lookup does: the innermost element whose text it is", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - generic [ref=e2]:`,
        `    - generic [ref=e3]: Draft`,
        `  - paragraph [ref=e4]: Draft saved`,
      ].join("\n")
    );

    // The wrapper's text is its child's: the lookup finds the child alone.
    expect(label(tree, "e3")).toEqual({
      label: '"Draft"',
      selector: 'internal:text="Draft"s',
    });
  });
});

describe("the label near an element", () => {
  it("names its nearest ancestor with a role or a name, when it has neither", () => {
    const tree = read(
      [
        `- generic [ref=e1]:`,
        `  - button "Save" [ref=e2]:`,
        `    - generic [ref=e3]:`,
        `      - img [ref=e4]`,
        `      - text: Save`,
      ].join("\n")
    );

    expect(labelNear(tree, tree.getNode("e3" as AriaRef)!)?.label).toBe(
      'button "Save"'
    );
  });

  it("names the element by the text inside it when no ancestor has a role or a name", () => {
    const tree = read(todos("buy milk"));

    expect(labelNear(tree, tree.getNode("e4" as AriaRef)!)?.label).toBe(
      '"items left"'
    );
  });

  it("is none for an element with no role, no name and no text, under none that has one", () => {
    const tree = read(
      [`- generic [ref=e1]:`, `  - generic [ref=e2]`].join("\n")
    );

    expect(labelNear(tree, tree.getNode("e2" as AriaRef)!)).toBeNull();
  });
});

describe("the words of a selector, for a step whose element is not known", () => {
  it("reads a role and its name as a label does", () => {
    expect(
      selectorWords('internal:role=link[name="chore: release main"i]', "x")
    ).toBe('link "chore: release main"');
    expect(
      selectorWords('internal:role=button[name="Say \\"hi\\""s]', "x")
    ).toBe('button "Say \\"hi\\""');
    expect(selectorWords("internal:role=heading", "x")).toBe("heading");
  });

  it("is Playwright's own words for any other selector, and none without them", () => {
    expect(selectorWords('internal:text="Saved"i', "getByText('Saved')")).toBe(
      "getByText('Saved')"
    );
    expect(
      selectorWords(
        "internal:role=heading[level=2]",
        "getByRole('heading', { level: 2 })"
      )
    ).toBe("getByRole('heading', { level: 2 })");
    expect(
      selectorWords(
        'internal:role=listitem >> internal:role=link[name="Go"i]',
        "getByRole('listitem').getByRole('link', { name: 'Go' })"
      )
    ).toBe("getByRole('listitem').getByRole('link', { name: 'Go' })");
    expect(selectorWords("#main", undefined)).toBeUndefined();
    expect(selectorWords(null, undefined)).toBeUndefined();
  });
});
