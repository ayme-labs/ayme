import type { ChangeRow } from "@ayme-dev/recorder/contract";

// Which of an entry's change rows the window lists, and which it folds into
// one, as the released window does. Display only: the engine's rows, and
// the Recording Package, keep every change.

/** A change row with its place among its entry's rows, by which a
 * highlight names it. */
export type PlacedRow = { readonly row: ChangeRow; readonly index: number };

/** Elements of one role that appeared in or were removed from one named
 * parent, folded into one row: what they fold with (`key`), which stays the
 * same as the rows around it come and go, the role, the parent's name and
 * the rows. */
export type FoldedRows = {
  readonly key: string;
  readonly role: string;
  readonly parent: string;
  readonly rows: readonly PlacedRow[];
};

/** How many elements of one role in one parent fold into one row. */
const FOLDS_FROM = 3;

/** Whether the only change a row says of its element is the cursor's. */
export const cursorOnly = (row: ChangeRow): boolean =>
  row.kind === "changed" &&
  (row.changed ?? []).length > 0 &&
  row.changed!.every((one) => one.property === "cursor");

/** What a row folds with: its role and its named parent, which is told
 * apart from another of the same name by its ref. None for a row that
 * changed, or that has no named parent. */
const foldKey = ({ kind, role, parent }: ChangeRow) =>
  kind !== "changed" && role && parent ? `${role}\u0000${parent.ref}` : null;

/**
 * The rows the window lists, in order: none for an element whose only
 * change is the cursor, and three or more elements of one role that
 * appeared in or were removed from one named parent as one row, where the
 * first of them sat.
 */
export function shownRows(
  rows: readonly ChangeRow[]
): (PlacedRow | FoldedRows)[] {
  const placed = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !cursorOnly(row));
  // The rows by what they fold with, in order. Those that fold with nothing
  // are kept under no key, and never read.
  const together = Map.groupBy(placed, ({ row }) => foldKey(row));
  const shown: (PlacedRow | FoldedRows)[] = [];
  for (const one of placed) {
    const key = foldKey(one.row);
    const folded = key ? together.get(key)! : [];
    if (folded.length < FOLDS_FROM) shown.push(one);
    else if (folded[0] === one)
      shown.push({
        key: key!,
        role: one.row.role!,
        parent: one.row.parent!.name,
        rows: folded,
      });
  }
  return shown;
}
