import type {
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

import type { ChangeRow, PropertyChange } from "../../contract";
import {
  namedInside,
  namedNear,
  ownName,
  wordsOf,
  type NamedElement,
} from "./elementNames";
import { changedItself } from "./packageText";

// The rows of a Change Tree, for whoever shows a recorder: plain data that
// crosses to the window and the toolbar as it is. The package's text is the
// other way to show the same tree (`changeText`).

/** The states a node can have, in the order the package's trees list them. */
const STATES = [
  "checked",
  "disabled",
  "expanded",
  "active",
  "selected",
  "pressed",
  "level",
] as const;

/** A row of a Change Tree, with the element it names: the one a highlight
 * of the row looks for on the page. Null when it names none. */
export type FoundRow = {
  readonly row: ChangeRow;
  readonly element: NamedElement | null;
};

/**
 * The topmost elements a Change Tree marks as added, removed or changed
 * themselves, in the order of the page, each named by its role and name
 * (`elementNames.ts`). One with no role and no name that appeared or was
 * removed is named by the named elements that went with it, a row each;
 * otherwise, as one that changed, by its nearest named ancestor. A changed
 * element says how each of its own properties stood before and after: the
 * tree keeps how each node stood before.
 */
export function foundRows(change: StructuralTree): FoundRow[] {
  const rows: FoundRow[] = [];
  const visit = (node: StructuralNode) => {
    if (!changedItself(node)) {
      for (const child of node.children)
        if (typeof child !== "string") visit(child);
      return;
    }
    const { kind } = node.status!;
    if (kind === "added" || kind === "removed") {
      const inside = ownName(node) ? [] : namedInside(node);
      const named = inside.length > 0 ? inside : [namedNear(change, node)];
      for (const element of named)
        rows.push({ row: { kind, element: wordsOf(element) }, element });
      return;
    }
    // Core records how every node it marks as changed stood before; a tree
    // without that record names no property.
    const before = change.getBeforeNode(node.ref) ?? node;
    const element = namedNear(change, node);
    rows.push({
      row: {
        kind: "changed",
        element: wordsOf(element),
        changed: changedProperties(before, node),
      },
      element,
    });
  };
  for (const root of change.getRootNodes()) visit(root);
  return rows;
}

/** A value as the package's trees write it; none for one absent or empty. */
const written = (value: string | number | boolean | undefined) =>
  value === undefined || value === "" || value === false
    ? undefined
    : String(value);

/** A node's own text: its text pieces, apart from the elements inside it,
 * joined by a space. */
const ownText = (node: StructuralNode) =>
  node.children.filter((child) => typeof child === "string").join(" ");

function changedProperties(
  before: StructuralNode,
  after: StructuralNode
): PropertyChange[] {
  const changes: PropertyChange[] = [];
  const compare = (
    property: string,
    from: string | number | boolean | undefined,
    to: string | number | boolean | undefined
  ) => {
    const was = written(from);
    const is = written(to);
    if (was !== is)
      changes.push({
        property,
        ...(was === undefined ? {} : { from: was }),
        ...(is === undefined ? {} : { to: is }),
      });
  };
  compare("role", before.role, after.role);
  compare("name", before.name, after.name);
  compare("text", ownText(before), ownText(after));
  for (const state of STATES)
    compare(state, before.state[state], after.state[state]);
  compare(
    "cursor",
    before.cursorPointer && "pointer",
    after.cursorPointer && "pointer"
  );
  for (const key of new Set([
    ...Object.keys(before.props),
    ...Object.keys(after.props),
  ]))
    compare(`/${key}`, before.props[key], after.props[key]);
  return changes;
}
