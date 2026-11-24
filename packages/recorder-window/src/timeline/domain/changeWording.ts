import type { ChangeRow, PropertyChange } from "@ayme-dev/recorder/contract";

import { cursorOnly } from "./changeGroups";

// How the window says what changed. The released recorder's wording is the
// baseline: "appeared", "was removed", "became active", "active state was
// cleared", "text changed from empty to “x”". A property it has no wording
// for still says something true: "<property> changed from … to …".

/** The states an element has or has not, as the engine names them. */
const STATES = new Set([
  "active",
  "checked",
  "disabled",
  "expanded",
  "selected",
  "pressed",
]);

/** A value as a person reads it: quoted, or "empty" when there is none or
 * it is empty. */
const quoted = (value: string | undefined) =>
  value === undefined || value === "" ? "empty" : `“${value}”`;

/** "<what> changed from … to …", with the values read by `read`. */
const fromTo = (
  what: string,
  { from, to }: PropertyChange,
  read: (value: string | undefined) => string
) => `${what} changed from ${read(from)} to ${read(to)}`;

/** One property's change, in words. */
function wordOf(change: PropertyChange): string {
  const { property, to } = change;
  if (STATES.has(property)) {
    if (to === undefined) return `${property} state was cleared`;
    return to === "mixed"
      ? `became partially ${property}`
      : `became ${property}`;
  }
  if (property === "cursor")
    return to === undefined ? "is no longer clickable" : "became clickable";
  if (property === "role" || property === "level")
    return fromTo(property, change, (value) => value ?? "none");
  // A property under its name with a slash, such as /url, by its name.
  return fromTo(property.replace(/^\//, ""), change, quoted);
}

/** What a change row says happened to its element. */
export function effectOf(row: ChangeRow): string {
  if (row.kind === "added") return "appeared";
  if (row.kind === "removed") return "was removed";
  const words = (row.changed ?? []).map(wordOf);
  return words.length === 0 ? "changed" : words.join(", ");
}

/** An element in a chip: its role and name, with the name in curly quotes
 * as the released window writes it. */
export const chipText = (element: string) =>
  element.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (_, name: string) => `“${name.replace(/\\(.)/g, "$1")}”`
  );

/** A row that folds elements of one role: how many, and the role, as
 * "30 listitems". Elements with no role of their own are "3 elements". */
export const groupText = (role: string, count: number) =>
  role === "generic"
    ? `${count} elements`
    : `${count} ${role}${/(s|x|ch|sh)$/.test(role) ? "es" : "s"}`;

/**
 * What happened to the elements a row folds, in their parent: "removed
 * from “Issues”" or "appeared in “Issues”" when all went the same way, and
 * "25 removed from, 5 appeared in “Issues”" otherwise, as the released
 * window says it.
 */
export function groupEffect(
  rows: readonly ChangeRow[],
  parent: string
): string {
  const removed = rows.filter((row) => row.kind === "removed").length;
  const appeared = rows.length - removed;
  const where = `“${parent}”`;
  if (appeared === 0) return `removed from ${where}`;
  if (removed === 0) return `appeared in ${where}`;
  return `${removed} removed from, ${appeared} appeared in ${where}`;
}

/**
 * The title of a change no Interaction made: how many elements appeared,
 * or were removed, when that is all it is; "UI Changed" otherwise. Every
 * element counts, folded or not, but none whose only change is the cursor.
 */
export function changeTitle(listed: readonly ChangeRow[]): string {
  const rows = listed.filter((row) => !cursorOnly(row));
  const count = rows.length;
  const all = (kind: ChangeRow["kind"]) =>
    count > 0 && rows.every((row) => row.kind === kind);
  const elements = count === 1 ? "Element" : `${count} elements`;
  if (all("added")) return `${elements} appeared`;
  if (all("removed")) return `${elements} removed`;
  return "UI Changed";
}
