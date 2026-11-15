import type {
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

import type { ChangeRow, PropertyChange } from "../../contract";
import { changedItself, leadsToChange } from "./packageText";

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

/**
 * The topmost elements a Change Tree marks as added, removed or changed
 * themselves, in the order of the page. A changed element says how each of
 * its own properties stood before and after: the tree keeps how each node
 * stood before.
 */
export function changeRows(change: StructuralTree): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const visit = (node: StructuralNode) => {
    if (!changedItself(node)) {
      for (const child of node.children)
        if (typeof child !== "string") visit(child);
      return;
    }
    const { kind } = node.status!;
    if (kind === "added" || kind === "removed") {
      rows.push({ kind, element: elementOf(node) });
      return;
    }
    // Core records how every node it marks as changed stood before; a tree
    // without that record names no property.
    const before = change.getBeforeNode(node.ref) ?? node;
    rows.push({
      kind: "changed",
      element: elementOf(node),
      changed: changedProperties(before, node),
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

/**
 * A node in the words of the package's trees, without its ref and its mark:
 * the header of its line, and the one text the line shows after it, quoted.
 */
function elementOf(node: StructuralNode): string {
  const words = [
    ...(node.role === "generic" ? [] : [node.role]),
    ...(node.name ? [`"${escaped(node.name)}"`] : []),
    ...statesOf(node),
    ...(node.cursorPointer ? ["[cursor=pointer]"] : []),
  ];
  const text = lineText(node);
  if (text) words.push(`"${text}"`);
  return words.length === 0 ? "element" : words.join(" ");
}

function statesOf({ state }: StructuralNode): string[] {
  const marks: string[] = [];
  for (const name of STATES) {
    const value = state[name];
    if (value === undefined || value === false) continue;
    marks.push(value === true ? `[${name}]` : `[${name}=${value}]`);
  }
  return marks;
}

/**
 * The text the node's line in a Change Tree shows after its header: its one
 * text child, when it keeps no element below it. The tree keeps below a
 * changed node only the elements that lead to a change. Quoted text is
 * written as the package's trees quote it.
 */
function lineText(node: StructuralNode): string {
  const texts = node.children.filter((child) => typeof child === "string");
  const below = node.children.some(
    (child) => typeof child !== "string" && leadsToChange(child)
  );
  if (texts.length !== 1 || below) return "";
  const [text] = texts;
  return QUOTED.test(text!) ? escaped(text!) : text!;
}

/** A text the package's trees quote: one they would misread otherwise. */
const QUOTED = /[:#[\]{},"'&*!?|<>%@`]|^\s|\s$/;

const escaped = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
