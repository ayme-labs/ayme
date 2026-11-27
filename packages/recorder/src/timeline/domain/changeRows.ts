import type {
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

import type { ChangeRow, PropertyChange } from "../../contract";
import {
  ElementNames,
  ownName,
  wordsOf,
  type NamedElement,
  type PageView,
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
  pageBefore: () => StructuralTree
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
      const push = (one: StructuralNode, element: NamedElement | null) =>
        rows.push({
          row: {
            kind,
            element: wordsOf(element),
            ...(element ? placeOf(names, one, view) : {}),
          },
          element,
        });
      const parts = inside(node, kind);
      if (!parts.some((part) => part.went))
        push(node, names.labelNear(node, view));
      // In the order of the page: what the page moved into it was there
      // before, keeps a status of its own, and is listed by what changed of
      // it.
      for (const { went, moved } of parts)
        if (went) push(went, names.labelOf(went, view));
        else visit(moved!);
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

type Part =
  | { readonly went: StructuralNode; readonly moved?: undefined }
  | { readonly went?: undefined; readonly moved: StructuralNode };

/** What is inside a node that appeared or was removed, in the order of the
 * page: the topmost named elements that went with it, when it has no name
 * of its own, and the topmost nodes that did not, as content the page moved
 * into a new wrapper. */
function inside(node: StructuralNode, kind: string): Part[] {
  const parts: Part[] = [];
  const walk = (parent: StructuralNode, named: boolean) => {
    for (const child of parent.children) {
      if (typeof child === "string") continue;
      if (child.status?.kind !== kind) {
        parts.push({ moved: child });
        continue;
      }
      const went = !named && ownName(child) !== null;
      if (went) parts.push({ went: child });
      walk(child, named || went);
    }
  };
  walk(node, ownName(node) !== null);
  return parts;
}

const cursorOnly = (changed: readonly PropertyChange[]) =>
  changed.length > 0 && changed.every((one) => one.property === "cursor");

/** An element's own role, and its nearest ancestor that has a name on the
 * page it is labelled on, by its ref and that name: whoever shows a
 * recorder can tell which elements went in or out of the same one. */
function placeOf(
  names: ElementNames,
  node: StructuralNode,
  view: PageView
): Pick<ChangeRow, "role" | "parent"> {
  const parent = names.ancestorsOf(node, view).find((one) => one.name);
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
