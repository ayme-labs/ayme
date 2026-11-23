import type { ChangeRow } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { cursorOnly, shownRows } from "./changeGroups";

// Which of an entry's change rows the window lists, and which it folds into
// one: display only, the engine's rows stay as they are.

const issues = { ref: "e2", name: "Issues" };
const item = (
  kind: "added" | "removed",
  name: string,
  parent: ChangeRow["parent"] | null = issues,
  role = "listitem"
): ChangeRow => ({
  kind,
  element: `${role} "${name}"`,
  role,
  ...(parent ? { parent } : {}),
});
const cursor = (to?: string): ChangeRow => ({
  kind: "changed",
  element: 'button "Pay"',
  changed: [{ property: "cursor", ...(to ? { to } : {}) }],
});

describe("the rows the window lists", () => {
  it("folds three or more elements of one role that appeared in or were removed from one named parent into one, where the first of them sat", () => {
    const heading: ChangeRow = { kind: "added", element: 'heading "Open"' };
    const rows = [
      heading,
      item("removed", "Old"),
      { kind: "changed", element: 'tab "Closed"' } as const,
      item("added", "New"),
      item("added", "Newer"),
    ];

    expect(shownRows(rows)).toEqual([
      { row: heading, index: 0 },
      {
        role: "listitem",
        parent: "Issues",
        rows: [
          { row: rows[1], index: 1 },
          { row: rows[3], index: 3 },
          { row: rows[4], index: 4 },
        ],
      },
      { row: rows[2], index: 2 },
    ]);
  });

  it("leaves two such elements as two rows", () => {
    const rows = [item("added", "One"), item("added", "Two")];

    expect(shownRows(rows)).toEqual([
      { row: rows[0], index: 0 },
      { row: rows[1], index: 1 },
    ]);
  });

  it("keeps apart the elements of two parents with the same name", () => {
    const pinned = { ref: "e6", name: "Issues" };
    const rows = [
      item("added", "A"),
      item("added", "B"),
      item("added", "C", pinned),
      item("added", "D", pinned),
    ];

    expect(shownRows(rows)).toHaveLength(4);
  });

  it("keeps apart elements of other roles, and never folds an element with no named parent or one that changed", () => {
    const rows: ChangeRow[] = [
      item("added", "A"),
      item("added", "B"),
      item("added", "Go", issues, "button"),
      item("added", "C", null),
      item("added", "D", null),
      item("added", "E", null),
      ...["F", "G", "H"].map((name): ChangeRow => ({
        kind: "changed",
        element: `listitem "${name}"`,
        changed: [{ property: "selected", to: "true" }],
        role: "listitem",
        parent: issues,
      })),
    ];

    expect(shownRows(rows)).toHaveLength(9);
  });

  it("lists no row for an element whose only change is the cursor, and keeps each other row's place among its entry's rows", () => {
    const appeared = item("added", "New");
    const both: ChangeRow = {
      kind: "changed",
      element: 'button "Pay"',
      changed: [
        { property: "disabled", from: "true" },
        { property: "cursor", to: "pointer" },
      ],
    };

    expect(shownRows([cursor("pointer"), appeared, cursor(), both])).toEqual([
      { row: appeared, index: 1 },
      { row: both, index: 3 },
    ]);
  });

  it("tells a change of the cursor alone from one that says nothing of what changed", () => {
    expect(cursorOnly(cursor("pointer"))).toBe(true);
    expect(cursorOnly(cursor())).toBe(true);
    expect(cursorOnly({ kind: "changed", element: "x", changed: [] })).toBe(
      false
    );
    expect(cursorOnly({ kind: "changed", element: "x" })).toBe(false);
  });
});
