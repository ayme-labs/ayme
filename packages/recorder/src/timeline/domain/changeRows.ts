import type {
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

import type { ChangeRow, PropertyChange } from "../../contract";
import {
  ElementNames,
  namedInside,
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
 * themselves, in the order of the page, each named by its label
 * (`elementNames.ts`), counted against the page after the change, or before
 * it, which `pageBefore` builds, for a removed one. One with no role and no name that appeared or was
 * removed is named by the named elements that went with it, a row each;
 * otherwise, as one that changed, by its nearest named ancestor. A changed
 * element says how each of its own properties stood before and after: the
 * tree keeps how each node stood before. One whose only change of its own
 * is the cursor, which whoever shows a recorder may leave out, has what
 * changed inside it listed after it. One that appeared or was removed says
 * its own role and the named ancestor it went in or out of (`placeOf`),
 * even when it is named by an ancestor.
 */
export function foundRows(
  change: StructuralTree,
  pageBefore?: () => StructuralTree
): FoundRow[] {
  const names = new ElementNames(change, pageBefore);
  const rows: FoundRow[] = [];
  const visit = (node: StructuralNode) => {
    if (changedItself(node) && listed(node)) return;
    for (const child of node.children)
      if (typeof child !== "string") visit(child);
  };
  /** Lists the rows of a node that changed itself; whether they say what
   * changed inside it too. */
  const listed = (node: StructuralNode): boolean => {
    const { kind } = node.status!;
    if (kind === "added" || kind === "removed") {
      const view = kind === "added" ? "after" : "before";
      const inside = ownName(node) ? [] : namedInside(node);
      const named =
        inside.length > 0
          ? inside.map((one) => ({ one, element: names.labelOf(one, view) }))
          : [{ one: node, element: names.labelNear(node, view) }];
      for (const { one, element } of named)
        rows.push({
          row: {
            kind,
            element: wordsOf(element),
            ...(element ? placeOf(change, one) : {}),
          },
          element,
        });
      return true;
    }
    // Core records how every node it marks as changed stood before; a tree
    // without that record names no property.
    const before = change.getBeforeNode(node.ref) ?? node;
    const element = names.labelNear(node, "after");
    const changed = changedProperties(before, node);
    rows.push({
      row: { kind: "changed", element: wordsOf(element), changed },
      element,
    });
    return !cursorOnly(changed);
  };
  for (const root of change.getRootNodes()) visit(root);
  return rows;
}

const cursorOnly = (changed: readonly PropertyChange[]) =>
  changed.length > 0 && changed.every((one) => one.property === "cursor");

/** An element's own role, and its nearest ancestor that has a name, by its
 * ref and that name: whoever shows a recorder can tell which elements went
 * in or out of the same one. */
function placeOf(
  change: StructuralTree,
  node: StructuralNode
): Pick<ChangeRow, "role" | "parent"> {
  const parent = change.getAncestorsOf(node.ref).find((one) => one.name);
  return {
    role: node.role,
    ...(parent ? { parent: { ref: parent.ref, name: parent.name } } : {}),
  };
}

/** A value as the package's trees write it; none for one absent or empty. */
const written = (value: string | number | boolean | undefined) =>
  value === undefined || value === "" || value === false
    ? undefined
    : String(value);

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
