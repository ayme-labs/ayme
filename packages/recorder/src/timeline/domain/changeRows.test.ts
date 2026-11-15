import {
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { describe, expect, it } from "vitest";

import { changeRows } from "./changeRows";

/** Core's Change Tree from one page to another, as Playwright's AI-mode
 * snapshot writes each. */
function changeFrom(before: string, after: string): StructuralTree {
  const refs = new SyntheticAriaRefFactory();
  return StructuralTree.reconcile(
    StructuralTree.fromAriaSnapshotYaml(before, refs),
    StructuralTree.fromAriaSnapshotYaml(after, refs)
  );
}
const page = (...elements: string[]) =>
  [`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`)].join("\n");

describe("the change rows of a Change Tree", () => {
  it("are none when nothing changed", () => {
    const same = page(`- button "Save" [ref=e2]`);

    expect(changeRows(changeFrom(same, same))).toEqual([]);
  });

  it("list an element that appeared and one that was removed once each, with nothing inside them", () => {
    const rows = changeRows(
      changeFrom(
        page(`- list "Old" [ref=e2]:`, `  - listitem [ref=e3]: Milk`),
        page(
          `- list "Cart" [ref=e4]:`,
          `  - listitem [ref=e5]: Bread`,
          `  - listitem [ref=e6]: Eggs`
        )
      )
    );

    expect(rows).toEqual([
      { kind: "added", element: 'list "Cart"' },
      { kind: "removed", element: 'list "Old"' },
    ]);
  });

  it("list only the topmost of the elements that changed, in the order of the page", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- region "Cart" [ref=e2]:`,
          `  - paragraph [ref=e3]: Empty`,
          `- button "Pay" [ref=e4]`
        ),
        page(
          `- region "Cart" [ref=e2]:`,
          `  - paragraph [ref=e3]: One item`,
          `  - button "Remove" [ref=e5]`,
          `- button "Pay" [active] [ref=e4]`
        )
      )
    );

    expect(rows.map(({ kind, element }) => [kind, element])).toEqual([
      ["changed", 'paragraph "One item"'],
      ["added", 'button "Remove"'],
      ["changed", 'button "Pay" [active]'],
    ]);
  });

  it("say of a changed element every property that changed, with how it stood before and after", () => {
    const [row] = changeRows(
      changeFrom(
        page(`- checkbox "Terms" [checked=mixed] [level=2] [ref=e2]`),
        page(
          `- checkbox "Terms" [checked] [disabled] [ref=e2] [cursor=pointer]`
        )
      )
    );

    expect(row).toEqual({
      kind: "changed",
      element: 'checkbox "Terms" [checked] [disabled] [cursor=pointer]',
      changed: [
        { property: "checked", from: "mixed", to: "true" },
        { property: "disabled", to: "true" },
        { property: "level", from: "2" },
        { property: "cursor", to: "pointer" },
      ],
    });
  });

  it("say of a changed element which of its own text, its name, its role and its properties changed", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- paragraph [ref=e2]: Not saved`,
          `- link "Docs" [ref=e3]:`,
          `  - /url: /old`,
          `- heading "Draft" [level=2] [ref=e4]`
        ),
        page(
          `- paragraph [ref=e2]: Saved`,
          `- link "Docs" [ref=e3]:`,
          `  - /url: /new`,
          `- heading "Final" [level=2] [ref=e4]`
        )
      )
    );

    expect(rows).toEqual([
      {
        kind: "changed",
        element: 'paragraph "Saved"',
        changed: [{ property: "text", from: "Not saved", to: "Saved" }],
      },
      {
        kind: "changed",
        element: 'link "Docs"',
        changed: [{ property: "/url", from: "/old", to: "/new" }],
      },
      {
        kind: "changed",
        element: 'heading "Final" [level=2]',
        changed: [{ property: "name", from: "Draft", to: "Final" }],
      },
    ]);
  });

  it("say of a state that went away, or of text that was emptied, how it stood before only", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- button "Pay" [pressed] [ref=e2] [cursor=pointer]`,
          `- status [ref=e3]: Saving`
        ),
        page(`- button "Pay" [ref=e2]`, `- status [ref=e3]`)
      )
    );

    expect(rows).toEqual([
      {
        kind: "changed",
        element: 'button "Pay"',
        changed: [
          { property: "pressed", from: "true" },
          { property: "cursor", from: "pointer" },
        ],
      },
      {
        kind: "changed",
        element: "status",
        changed: [{ property: "text", from: "Saving" }],
      },
    ]);
  });

  it("say nothing of a value that is absent before or after, not even that it is undefined", () => {
    const [row] = changeRows(
      changeFrom(
        page(`- button "Pay" [pressed] [ref=e2]`),
        page(`- button "Pay" [disabled] [ref=e2]`)
      )
    );

    expect(row!.changed).toStrictEqual([
      { property: "disabled", to: "true" },
      { property: "pressed", from: "true" },
    ]);
  });

  it("say of a changed element that its role changed", () => {
    const [row] = changeRows(
      changeFrom(page(`- button "Go" [ref=e2]`), page(`- link "Go" [ref=e2]`))
    );

    expect(row).toEqual({
      kind: "changed",
      element: 'link "Go"',
      changed: [{ property: "role", from: "button", to: "link" }],
    });
  });

  it("read an element's own text as its text pieces, apart from the elements inside it", () => {
    const [row] = changeRows(
      changeFrom(
        page(
          `- paragraph [ref=e2]:`,
          `  - text: Total`,
          `  - strong [ref=e3]: "5"`,
          `  - text: items`
        ),
        page(
          `- paragraph [ref=e2]:`,
          `  - text: Sum`,
          `  - strong [ref=e3]: "5"`,
          `  - text: items`
        )
      )
    );

    expect(row!.changed).toEqual([
      { property: "text", from: "Total items", to: "Sum items" },
    ]);
  });

  it("show an element's one text only when the line keeps no element below it", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- listitem [ref=e2]:`,
          `  - text: Milk`,
          `  - button "Remove" [ref=e3]`,
          `- listitem [ref=e4]:`,
          `  - text: Tea`,
          `  - button "Remove" [ref=e5]`
        ),
        page(
          // Its text changed; the button inside it did not.
          `- listitem [ref=e2]:`,
          `  - text: Bread`,
          `  - button "Remove" [ref=e3]`,
          // Its text and the button inside it changed.
          `- listitem [ref=e4]:`,
          `  - text: Coffee`,
          `  - button "Remove" [disabled] [ref=e5]`,
          // It appeared, with the button inside it.
          `- listitem [ref=e6]:`,
          `  - text: Eggs`,
          `  - button "Remove" [ref=e7]`,
          `- paragraph [ref=e8]:`,
          `  - text: Two`,
          `  - text: lines`
        )
      )
    );

    expect(rows.map((row) => row.element)).toEqual([
      'listitem "Bread"',
      "listitem",
      "listitem",
      "paragraph",
    ]);
  });

  it("name an element with a state that is off as without it", () => {
    const [row] = changeRows(
      changeFrom(
        page(`- checkbox "Terms" [checked] [ref=e2]`),
        page(`- checkbox "Terms" [checked=false] [pressed=false] [ref=e2]`)
      )
    );

    expect(row).toEqual({
      kind: "changed",
      element: 'checkbox "Terms"',
      changed: [{ property: "checked", from: "true" }],
    });
  });

  it("name an element in the words of the package's trees: its role and name, its states, and its one text quoted", () => {
    const rows = changeRows(
      changeFrom(
        page(`- paragraph [ref=e2]: "Items: 0"`),
        page(
          `- paragraph [ref=e2]: "Items: 1"`,
          `- generic [ref=e3]`,
          `- option "Say \\"hi\\"" [selected] [expanded] [ref=e4]`,
          `- generic [ref=e5]: Total`,
          `- button "a\\\\b" [ref=e6]`
        )
      )
    );

    expect(rows.map((row) => row.element)).toEqual([
      'paragraph "Items: 1"',
      "element",
      'option "Say \\"hi\\"" [expanded] [selected]',
      '"Total"',
      'button "a\\\\b"',
    ]);
  });
});
