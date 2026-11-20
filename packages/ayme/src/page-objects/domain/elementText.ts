// A declared element child's text in the Page Object Tree, read from a
// capture of the page by the element's Structural Ref, and how it changed,
// read from two captures reconciled: the notation `snapshot` uses, without
// refs or marks.
import {
  isSyntheticRef,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
  type AriaRef,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";

type Child = StructuralNode["children"][number];

/**
 * A node that only wraps its children, an unnamed `generic`, shows them in
 * its place, as Playwright's aria snapshot shows them.
 */
const wraps = (node: StructuralNode) =>
  node.role === "fragment" || (node.role === "generic" && !node.name);

/** `children` with each wrapping node replaced by its own children. */
const unwrapped = (children: readonly Child[]): Child[] =>
  children.flatMap((child) =>
    typeof child !== "string" && wraps(child)
      ? unwrapped(child.children)
      : [child]
  );

/** `nodes` as compact text without refs, marks or statuses. */
function render(
  roots: readonly Child[],
  children: (node: StructuralNode) => readonly Child[] = (node) =>
    unwrapped(node.children)
): string {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      {
        roots: unwrapped(roots),
        structuralNode: (node) => node,
        children,
      },
      { includeIdentity: false, includeStatus: false }
    )
  );
}

/**
 * The accessibility subtree of the element `tree` names `ref`, as compact
 * text without refs; "" when the tree has no such node.
 */
export function elementText(tree: StructuralTree, ref: AriaRef): string {
  const node = tree.getNode(ref);
  return node ? render([node]) : "";
}

/** The lines of `node` alone: its own line and its text, none of its child nodes. */
function ownLines(node: StructuralNode): string[] {
  const texts = node.children.filter(
    (child): child is string => typeof child === "string"
  );
  if (!wraps(node)) return render([node], () => texts).split("\n");
  return texts.map((text) => render([text]));
}

const indent = (lines: readonly string[], depth: number) =>
  lines.map((line) => "  ".repeat(Math.max(depth, 0)) + line);

/** Lines that were added: `+ ` on the first, the rest kept aligned under it. */
const added = (lines: readonly string[]) => [
  `+ ${lines[0]}`,
  ...indent(lines.slice(1), 1),
];

/**
 * One line's change: `key: old → new` when only the value after the role,
 * name and states changed, else the whole line `old → new`.
 */
export function valueChange(before: string, after: string): string {
  const left = splitAriaLine(before);
  const right = splitAriaLine(after);
  if (left && right && left.key === right.key)
    return `${left.key}: ${left.value ?? '""'} → ${right.value ?? '""'}`;
  return `${before} → ${after.replace(/^- /, "")}`;
}

const ARIA_LINE =
  /^((?:- )?[^\s:"[\]]+(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;

function splitAriaLine(
  line: string
): { key: string; value?: string } | undefined {
  const match = ARIA_LINE.exec(line);
  if (!match) return undefined;
  return match[2] === undefined
    ? { key: match[1]! }
    : { key: match[1]!, value: match[2] };
}

/** How an element's text changed, as a whole: one line as `old → new`. */
function textChange(before: string, after: string): string[] {
  if (before === after) return [];
  const old = before.split("\n");
  const now = after.split("\n");
  if (old.length === 1 && now.length === 1)
    return [valueChange(old[0]!, now[0]!)];
  return [`${old[0]} (removed)`, ...added(now)];
}

/** How `node`'s own line changed from `before`'s. */
function ownChange(before: StructuralNode, node: StructuralNode): string[] {
  const old = ownLines(before);
  const now = ownLines(node);
  if (old.length === 1 && now.length === 1)
    return [valueChange(old[0]!, now[0]!)];
  // A line of several texts: what was there, then what is.
  return [`${old[0]} (removed)`, ...old.slice(1), ...added(now)];
}

/**
 * The changes in the subtree of `node`, a node of `reconciled`: a node whose
 * own line changed as `old → new`, one that went away as its line marked
 * `(removed)`, one that appeared in full after `+`. Unchanged lines are left
 * out; each change keeps the indentation of its line.
 */
function subtreeChanges(
  reconciled: StructuralTree,
  node: StructuralNode,
  depth: number
): string[] {
  const status = node.status;
  if (status?.kind === "added")
    return indent(added(render([node]).split("\n")), depth);
  if (status?.kind === "removed")
    return indent([`${ownLines(node)[0]} (removed)`], depth);
  const lines: string[] = [];
  const before = reconciled.getBeforeNode(node.ref);
  if (status?.kind === "updated" && status.selfChanged && before)
    lines.push(...indent(ownChange(before, node), depth));
  const below = wraps(node) ? depth : depth + 1;
  for (const child of node.children)
    if (typeof child !== "string")
      lines.push(...subtreeChanges(reconciled, child, below));
  return lines;
}

/**
 * The node of `reconciled` that the after capture's `ref` names, and the
 * ref the before capture named it by, if it was there: a synthetic ref
 * matched to a synthetic ref keeps the before one.
 */
function reconciledNode(
  reconciled: StructuralTree,
  ref: AriaRef
): { node: StructuralNode; before?: AriaRef } | undefined {
  const before = reconciled.getBeforeNodeForAfterRef(ref)?.ref;
  const node =
    (before !== undefined && isSyntheticRef(before) && isSyntheticRef(ref)
      ? reconciled.getNode(before)
      : undefined) ?? reconciled.getNode(ref);
  if (!node) return undefined;
  if (node.status?.kind === "added") return { node };
  return { node, before: before ?? ref };
}

/**
 * One element of a declared child: its ref in the capture the tree was read
 * from and its subtree there, or, for an element the capture holds no node
 * of, such as a span of text, the ref the page names it by and its own aria
 * snapshot.
 */
export type ChildElement = {
  readonly ref: string;
  readonly text: string;
  readonly captured: boolean;
};

/**
 * How the elements of a declared child changed between the capture
 * `before` was read from and the one `after` was read from, by `reconciled`,
 * the two reconciled: an element that left the child marked `(removed)` on
 * its first line, one that joined it in full after `+`, and the changes
 * inside each element that stayed. Empty when nothing changed. A `single`
 * element's child nodes are not indented, as the tree shows its first line
 * after the child's name and the rest below it.
 */
export function elementChanges(
  reconciled: StructuralTree,
  before: readonly ChildElement[],
  after: readonly ChildElement[],
  single: boolean
): string[] {
  const was = new Map(before.map((element) => [element.ref, element]));
  const stayed = new Set<string>();
  const changes: string[] = [];
  for (const element of after) {
    if (!element.text) continue;
    const old = was.get(element.ref);
    // An element no capture holds a node of: its text, as it was and is.
    if (!element.captured) {
      if (old && !old.captured) {
        stayed.add(old.ref);
        changes.push(...textChange(old.text, element.text));
      } else changes.push(...added(element.text.split("\n")));
      continue;
    }
    const found = reconciledNode(reconciled, element.ref as AriaRef);
    if (found?.before !== undefined && was.get(found.before)?.captured) {
      stayed.add(found.before);
      changes.push(...subtreeChanges(reconciled, found.node, single ? -1 : 0));
    } else changes.push(...added(element.text.split("\n")));
  }
  const removed = before
    .filter(({ ref, text }) => !stayed.has(ref) && text)
    .map(({ text }) => `${text.split("\n")[0]} (removed)`);
  return [...removed, ...changes];
}
