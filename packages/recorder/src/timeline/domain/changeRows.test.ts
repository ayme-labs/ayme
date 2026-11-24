import {
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { describe, expect, it } from "vitest";

import type { ChangeRow } from "../../contract";
import { foundRows } from "./changeRows";

/** A Change Tree and the page before it. */
type Change = {
  readonly change: StructuralTree;
  readonly before: StructuralTree;
};

/** The rows of a Change Tree, as whoever shows a recorder is told them. */
const changeRows = ({ change, before }: Change): ChangeRow[] =>
  foundRows(change, () => before).map(({ row }) => row);

/** Core's Change Tree from one page to another, as Playwright's AI-mode
 * snapshot writes each, with the page before it. */
function changeFrom(before: string, after: string): Change {
  const refs = new SyntheticAriaRefFactory();
  const page = StructuralTree.fromAriaSnapshotYaml(before, refs);
  return {
    change: StructuralTree.reconcile(
      page,
      StructuralTree.fromAriaSnapshotYaml(after, refs)
    ),
    before: page,
  };
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
      { kind: "added", element: 'list "Cart"', role: "list" },
      { kind: "removed", element: 'list "Old"', role: "list" },
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
      ["changed", 'button "Pay"'],
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
      element: 'checkbox "Terms"',
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
        element: 'heading "Final"',
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

  it("name an element by its role and name only: its own text stands for the name of an unnamed element with nothing but text inside it", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- paragraph [ref=e2]: "Items: 0"`,
          `- listitem [ref=e3]:`,
          `  - text: Milk`,
          `  - button "Remove" [ref=e4]`
        ),
        page(
          `- paragraph [ref=e2]: "Items: 1"`,
          // Its text changed; it has an element inside it.
          `- listitem [ref=e3]:`,
          `  - text: Bread`,
          `  - button "Remove" [ref=e4]`,
          `- option "Say \\"hi\\"" [selected] [expanded] [ref=e5]`,
          `- generic [ref=e6]: Total`,
          `- button "a\\\\b" [ref=e7]`,
          `- paragraph [ref=e8]:`,
          `  - text: Two`,
          `  - text: lines`,
          // A button the page gives no name, with its text inside.
          `- button [ref=e9] [cursor=pointer]: All Items`
        )
      )
    );

    expect(rows.map((row) => row.element)).toEqual([
      'paragraph "Items: 1"',
      "listitem",
      'option "Say \\"hi\\""',
      '"Total"',
      'button "a\\\\b"',
      'paragraph "Two lines"',
      'button "All Items"',
    ]);
  });

  it("name each element so its label fits it alone on its page, as on a to-do list: with the text inside it, inside an ancestor, or by the text inside it alone", () => {
    const todos = (left: string, ...items: string[]) =>
      page(
        `- list [ref=e3]:`,
        ...items.flatMap((item, at) => [
          `  - listitem [ref=e${10 + 2 * at}]:`,
          `    - checkbox "Toggle Todo"${item.startsWith("✓") ? " [checked]" : ""} [ref=e${11 + 2 * at}]`,
          `    - text: ${item.replace("✓", "")}`,
        ]),
        `- generic [ref=e4]:`,
        `  - strong [ref=e5]: "${items.length}"`,
        `  - text: ${left}`
      );

    // A to-do added: the item, and the count, by its longest text.
    expect(
      changeRows(
        changeFrom(
          todos("item left", "buy milk"),
          todos("items left", "buy milk", "feed the cat")
        )
      ).map((row) => row.element)
    ).toEqual(['listitem "feed the cat"', '"items left"']);
    // One checked: its checkbox, inside its item.
    expect(
      changeRows(
        changeFrom(
          todos("items left", "buy milk", "feed the cat"),
          todos("items left", "buy milk", "✓feed the cat")
        )
      ).map((row) => row.element)
    ).toEqual(['listitem "feed the cat" › checkbox "Toggle Todo"']);
    // One removed: named as the page before had it.
    expect(
      changeRows(
        changeFrom(
          todos("items left", "buy milk", "feed the cat"),
          todos("item left", "buy milk")
        )
      )
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "removed",
          element: 'listitem "feed the cat"',
          role: "listitem",
        },
      ])
    );
  });

  it("name an element with no role and no name that appeared or was removed by the named elements that went with it, each in a row of its own", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- generic [ref=e2]:`,
          `  - text: Menu`,
          `  - button "Open Menu" [ref=e3]`,
          `- generic [ref=e4]:`,
          `  - heading "Menu" [level=2] [ref=e5]`,
          `  - generic [ref=e6]:`,
          `    - link "About" [ref=e7]:`,
          `      - generic [ref=e8]: About us`
        ),
        page()
      )
    );

    expect(rows).toEqual([
      { kind: "removed", element: 'button "Open Menu"', role: "button" },
      { kind: "removed", element: 'heading "Menu"', role: "heading" },
      { kind: "removed", element: 'link "About"', role: "link" },
    ]);
  });

  it("name an element with no role and no name by its nearest named ancestor when nothing named went with it", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- navigation "Main" [ref=e2]:`,
          `  - generic [ref=e3]:`,
          `    - generic [ref=e4]`
        ),
        page(
          `- navigation "Main" [ref=e2]:`,
          `  - generic [ref=e3]:`,
          `    - generic [ref=e4] [cursor=pointer]`,
          `    - generic [ref=e5]`
        )
      )
    );

    expect(rows).toEqual([
      {
        kind: "changed",
        element: 'navigation "Main"',
        changed: [{ property: "cursor", to: "pointer" }],
      },
      // Named by its ancestor, it says its own role and its own parent.
      {
        kind: "added",
        element: 'navigation "Main"',
        role: "generic",
        parent: { ref: "e2", name: "Main" },
      },
    ]);
  });

  it("say of an element that appeared or was removed its role and its nearest ancestor that has a name, which element that is and its name", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- list "Issues" [ref=e2]:`,
          `  - listitem [ref=e3]: Old`,
          `- region "Pinned" [ref=e4]:`,
          `  - generic [ref=e5]:`,
          `    - list "Issues" [ref=e6]`
        ),
        page(
          `- list "Issues" [ref=e2]:`,
          `  - listitem [ref=e7]: New`,
          `- region "Pinned" [ref=e4]:`,
          `  - generic [ref=e5]:`,
          `    - list "Issues" [ref=e6]:`,
          `      - listitem [ref=e8]: Pinned`,
          // Nothing around it has a name.
          `- button "Top" [ref=e9]`
        )
      )
    );

    expect(rows).toEqual([
      {
        kind: "added",
        element: 'listitem "New"',
        role: "listitem",
        parent: { ref: "e2", name: "Issues" },
      },
      {
        kind: "removed",
        element: 'listitem "Old"',
        role: "listitem",
        parent: { ref: "e2", name: "Issues" },
      },
      // A list of the same name is another parent.
      {
        kind: "added",
        element: 'listitem "Pinned"',
        role: "listitem",
        parent: { ref: "e6", name: "Issues" },
      },
      { kind: "added", element: 'button "Top"', role: "button" },
    ]);
  });

  it("build the page before the change only to name a removed element, once for all of them", () => {
    let built = 0;
    /** The rows of a Change Tree whose page before counts each time it is
     * built. */
    const counted = ({ change, before }: Change) =>
      foundRows(change, () => {
        built += 1;
        return before;
      });

    counted(
      changeFrom(
        page(`- paragraph [ref=e2]: Empty`),
        page(`- paragraph [ref=e2]: One item`, `- button "Remove" [ref=e3]`)
      )
    );
    expect(built).toBe(0);

    counted(
      changeFrom(
        page(
          `- button "Undo" [ref=e2]`,
          `- button "Redo" [ref=e3]`,
          `- paragraph [ref=e4]: Saved`
        ),
        page(`- paragraph [ref=e4]: Saved`)
      )
    );
    expect(built).toBe(1);
  });

  it("say of elements named by their ancestor their own role and their own parent, whether they appeared or were removed", () => {
    const site = (...inside: string[]) =>
      page(
        `- region "Site" [ref=e2]:`,
        `  - navigation "Main" [ref=e3]:`,
        ...inside.map((line) => `    ${line}`)
      );
    const placed = (kind: "added" | "removed") => ({
      kind,
      element: 'navigation "Main"',
      role: "generic",
      parent: { ref: "e3", name: "Main" },
    });

    expect(
      changeRows(
        changeFrom(
          site(`- generic [ref=e4]`),
          site(
            `- generic [ref=e4]`,
            `- generic [ref=e5]`,
            `- generic [ref=e6]`,
            `- generic [ref=e7]`
          )
        )
      )
    ).toEqual([placed("added"), placed("added"), placed("added")]);
    expect(
      changeRows(
        changeFrom(
          site(
            `- generic [ref=e4]`,
            `- generic [ref=e5]`,
            `- generic [ref=e6]`,
            `- generic [ref=e7]`
          ),
          site(`- generic [ref=e4]`)
        )
      )
    ).toEqual([placed("removed"), placed("removed"), placed("removed")]);
  });

  it("list what changed inside an element whose only change of its own is the cursor, after its row", () => {
    const rows = changeRows(
      changeFrom(
        page(`- list "Issues" [ref=e2]:`, `  - listitem [ref=e3]: A`),
        page(
          `- list "Issues" [ref=e2] [cursor=pointer]:`,
          `  - listitem [ref=e3]: A`,
          `  - listitem [ref=e4]: B`,
          `  - listitem [ref=e5]: C`,
          `  - listitem [ref=e6]: D`
        )
      )
    );
    const item = (name: string) => ({
      kind: "added",
      element: `listitem "${name}"`,
      role: "listitem",
      parent: { ref: "e2", name: "Issues" },
    });

    expect(rows).toEqual([
      {
        kind: "changed",
        element: 'list "Issues"',
        changed: [{ property: "cursor", to: "pointer" }],
      },
      item("B"),
      item("C"),
      item("D"),
    ]);
  });

  it("list nothing inside an element that changed itself in another way too, its cursor or not", () => {
    const rows = changeRows(
      changeFrom(
        page(`- list "Issues" [ref=e2]:`, `  - listitem [ref=e3]: A`),
        page(
          `- list "Closed issues" [ref=e2] [cursor=pointer]:`,
          `  - listitem [ref=e3]: A`,
          `  - listitem [ref=e4]: B`
        )
      )
    );

    expect(rows).toEqual([
      {
        kind: "changed",
        element: 'list "Closed issues"',
        changed: [
          { property: "name", from: "Issues", to: "Closed issues" },
          { property: "cursor", to: "pointer" },
        ],
      },
    ]);
  });

  it("list nothing inside an element that changed itself in a way no property names", () => {
    const rows = changeRows(
      changeFrom(
        page(
          `- paragraph [ref=e2]:`,
          `  - text: Total`,
          `  - strong [ref=e3]: "5"`
        ),
        page(
          `- paragraph [ref=e2]:`,
          `  - strong [ref=e3]: "5"`,
          `  - text: Total`,
          `  - button "Undo" [ref=e4]`
        )
      )
    );

    expect(rows).toEqual([
      { kind: "changed", element: "paragraph", changed: [] },
    ]);
  });

  it("name an element by the word 'element' only when nothing around it has a role or a name", () => {
    const rows = changeRows(changeFrom(page(), page(`- generic [ref=e2]`)));

    expect(rows).toEqual([{ kind: "added", element: "element" }]);
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
});
