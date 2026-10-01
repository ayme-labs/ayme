import { expect, it } from "vitest";

import { buildStructureTree } from "../adapter/structure";
import { refTreeRows, type RefTreeRow } from "./refTree";

// Unit tests: the ref field's search over the structure tree model. The page
// state is hand-written in the compact notation an agent receives; the
// expected rows follow from it, not from the code under test.

const { roots } = buildStructureTree(
  `- e1 main:
  - e2 heading "Groceries" [level=1]
  - e3 ListPage:
    - text: New item
    - e4 textbox "New item"
    - e5 button "Add item" [cursor=pointer]
  - e6 list "Items":
    - e7 listitem: Milk
    - e8 listitem:
      - e9 button "Archive"`,
  new Map()
);

/** A row as the tree shows it: indented ref, role and name. */
function shown(rows: readonly RefTreeRow[]) {
  return rows.map(
    ({ node, depth }) =>
      `${"  ".repeat(depth)}${node.ref} ${node.role}${node.name ? ` "${node.name}"` : ""}`
  );
}

it("shows every node with a ref when nothing is searched", () => {
  expect(shown(refTreeRows(roots, {}))).toEqual([
    "e1 main",
    '  e2 heading "Groceries"',
    "  e3 generic",
    '    e4 textbox "New item"',
    '    e5 button "Add item"',
    '  e6 list "Items"',
    "    e7 listitem",
    "    e8 listitem",
    '      e9 button "Archive"',
  ]);
});

it("keeps each match's ancestors and leaves the rest out", () => {
  const rows = refTreeRows(roots, { query: "archive" });

  expect(shown(rows)).toEqual([
    "e1 main",
    '  e6 list "Items"',
    "    e8 listitem",
    '      e9 button "Archive"',
  ]);
  // The ancestors are there for context: they aren't matches.
  expect(rows.map((row) => row.match)).toEqual([false, false, false, true]);
});

it("matches every word of the query in a node's ref, role, name or text", () => {
  expect(shown(refTreeRows(roots, { query: 'BUTTON "add' }))).toEqual([
    "e1 main",
    "  e3 generic",
    '    e5 button "Add item"',
  ]);
  // A list item's text reads as the item's own.
  expect(shown(refTreeRows(roots, { query: "milk" }))).toEqual([
    "e1 main",
    '  e6 list "Items"',
    "    e7 listitem",
  ]);
  expect(refTreeRows(roots, { query: "e7" }).at(-1)?.text).toBe("Milk");
});

it("shows nothing when no node matches", () => {
  expect(refTreeRows(roots, { query: "checkout" })).toEqual([]);
});

it("disables the nodes the tool can't use, and keeps them in the tree", () => {
  // A fill-like tool: only text fields.
  const rows = refTreeRows(roots, {
    query: "item",
    canUse: (node) => node.role === "textbox",
  });

  expect(
    rows.map(
      ({ node, usable }) => `${node.ref} ${usable ? "usable" : "disabled"}`
    )
  ).toEqual([
    "e1 disabled",
    "e3 disabled",
    "e4 usable",
    "e5 disabled",
    "e6 disabled",
    "e7 disabled",
    "e8 disabled",
  ]);
});
