// The Page Object Tree as `page_objects` answers it: the Page Objects on the
// page, nested as their models nest, each declared child that is an element
// shown as its accessibility subtree, and each Page Object that has a root
// with its id; and how that tree changed, as a Page Object Tool's answer to
// an agent carries it. Text only: no Structural Ref, tool name or schema
// appears.
import { StructuralTree } from "@ayme-dev/core/structural-observation";
import { elementChanges, type ChildElement } from "./elementText";
import type { PageObjectId } from "./pageObjectId";

/** One Page Object in the tree. */
export type PageObjectTreeNode = {
  className: string;
  /** Its Page Object id, when its class has a Page Object Root. */
  id?: PageObjectId;
  children: readonly PageObjectTreeChild[];
};

/**
 * A declared child of a Page Object: elements, each by its ref in the
 * capture the tree was read from and its text there, or the Page Objects it
 * holds.
 */
/** A Page Object Tree and the capture of the page it was read from. */
export type PageObjectTreeRead = {
  objects: readonly PageObjectTreeNode[];
  tree: StructuralTree;
};

export type PageObjectTreeChild =
  | {
      kind: "elements";
      name: string;
      /** Whether the child is a Locator collection. */
      collection: boolean;
      elements: readonly ChildElement[];
    }
  | { kind: "object"; name: string; object: PageObjectTreeNode }
  | { kind: "objects"; name: string; objects: readonly PageObjectTreeNode[] };

export const MAX_CHILD_LINES = 40;
export const MAX_LINE_LENGTH = 200;

/**
 * The lines of a declared child that holds elements, from each element's
 * aria snapshot: one element's first line follows the child's name; a
 * Locator collection lists its elements below it, `[]` when it holds none.
 * Undefined for a single element that is not on the page. A child longer
 * than `MAX_CHILD_LINES` is cut and says how much was left out.
 */
export function elementLines(
  snapshots: readonly string[],
  collection: boolean
): string[] | undefined {
  const present = snapshots.filter((snapshot) => snapshot.trim());
  if (present.length === 0) return collection ? ["[]"] : undefined;
  let lines: string[];
  if (!collection && present.length === 1) {
    const own = present[0]!.split("\n");
    lines =
      own[0]!.startsWith("- ") && own.slice(1).every((line) => /^\s/.test(line))
        ? [own[0]!.slice(2), ...own.slice(1).map((line) => line.slice(2))]
        : ["", ...own];
  } else lines = ["", ...present.flatMap((snapshot) => snapshot.split("\n"))];
  lines = lines.map(shortLine);
  if (lines.length <= MAX_CHILD_LINES) return lines;
  const left = lines.length - MAX_CHILD_LINES;
  return [
    ...lines.slice(0, MAX_CHILD_LINES),
    `- (${left} more line${left === 1 ? "" : "s"} not shown)`,
  ];
}

const shortLine = (line: string) =>
  line.length <= MAX_LINE_LENGTH
    ? line
    : `${line.slice(0, MAX_LINE_LENGTH - 1)}…`;

const indent = (lines: readonly string[], by: number) =>
  lines.map((line) => " ".repeat(by) + line);

/**
 * A Page Object's label: its class and, when it has one, its id, as a
 * Structural Page State shows them on its root.
 */
const label = (node: PageObjectTreeNode) =>
  node.id ? `${node.className} ${node.id}` : node.className;

/** The Page Object Tree as `page_objects` answers it. */
export function renderPageObjectTree(
  tree: readonly PageObjectTreeNode[]
): string {
  if (tree.length === 0) return "No Page Object is on the page.";
  return tree
    .flatMap((node) => [label(node), ...indent(bodyLines(node), 2)])
    .join("\n");
}

function bodyLines(node: PageObjectTreeNode): string[] {
  return node.children.flatMap(childLines);
}

function childLines(child: PageObjectTreeChild): string[] {
  switch (child.kind) {
    case "elements": {
      const lines = linesOf(child);
      // A single element child that is not on the page is left out.
      if (!lines) return [];
      const [first = "", ...rest] = lines;
      return [`${child.name}:${first ? ` ${first}` : ""}`, ...indent(rest, 2)];
    }
    case "object":
      return [
        `${child.name}: ${label(child.object)}`,
        ...indent(bodyLines(child.object), 2),
      ];
    case "objects":
      return child.objects.length === 0
        ? [`${child.name}: []`]
        : [
            `${child.name}:`,
            ...child.objects.flatMap((node) =>
              indent([`- ${label(node)}`, ...indent(bodyLines(node), 4)], 2)
            ),
          ];
  }
}

type ElementsChild = Extract<PageObjectTreeChild, { kind: "elements" }>;

const linesOf = (child: ElementsChild) =>
  elementLines(
    child.elements.map(({ text }) => text),
    child.collection
  );

/** Lines that were added: `+ ` on the first, the rest kept aligned under it. */
const added = (lines: readonly string[]) =>
  lines.length === 0 ? [] : [`+ ${lines[0]}`, ...indent(lines.slice(1), 2)];

const sameNode = (left: PageObjectTreeNode, right: PageObjectTreeNode) =>
  left.className === right.className && left.id === right.id;

/**
 * How the Page Object Tree changed from `before` to `after`, in the tree's
 * own notation: a changed value as `old → new`, a Page Object or child that
 * went away marked `(removed)`, one that appeared shown in full after `+`,
 * with its children and id. An element child's changes are read from the
 * two captures reconciled, so only what changed in it shows. Unchanged Page
 * Objects and children are left out. Undefined when nothing changed.
 */
export function renderPageObjectTreeChanges(
  before: PageObjectTreeRead,
  after: PageObjectTreeRead
): string | undefined {
  const changes = new TreeChanges(
    StructuralTree.reconcile(before.tree, after.tree)
  );
  const lines: string[] = [];
  for (const old of before.objects)
    if (!after.objects.some((node) => sameNode(node, old)))
      lines.push(`- ${label(old)} (removed)`);
  for (const node of after.objects) {
    const old = before.objects.find((candidate) => sameNode(candidate, node));
    if (!old) {
      lines.push(...added([label(node), ...indent(bodyLines(node), 2)]));
      continue;
    }
    const inner = changes.ofNode(old, node);
    if (inner.length) lines.push(label(node), ...indent(inner, 2));
  }
  return lines.length ? lines.join("\n") : undefined;
}

function removedChild(child: PageObjectTreeChild): string {
  switch (child.kind) {
    case "elements": {
      const first = linesOf(child)?.[0];
      return first && first !== "[]"
        ? `${child.name}: ${first} (removed)`
        : `${child.name} (removed)`;
    }
    case "object":
      return `${child.name}: ${label(child.object)} (removed)`;
    case "objects":
      return `${child.name} (removed)`;
  }
}

/** The changes between two reads of the tree, by their captures reconciled. */
class TreeChanges {
  constructor(private readonly reconciled: StructuralTree) {}

  ofNode(before: PageObjectTreeNode, after: PageObjectTreeNode): string[] {
    const lines: string[] = [];
    for (const old of before.children)
      if (!after.children.some((child) => child.name === old.name))
        lines.push(removedChild(old));
    for (const child of after.children) {
      const old = before.children.find(({ name }) => name === child.name);
      lines.push(
        ...(old ? this.ofChild(old, child) : added(childLines(child)))
      );
    }
    return lines;
  }

  private ofChild(
    before: PageObjectTreeChild,
    after: PageObjectTreeChild
  ): string[] {
    const replaced = () => [removedChild(before), ...added(childLines(after))];
    if (before.kind === "elements" && after.kind === "elements")
      return this.ofElements(before, after);
    if (before.kind === "object" && after.kind === "object") {
      if (!sameNode(before.object, after.object)) return replaced();
      const inner = this.ofNode(before.object, after.object);
      return inner.length
        ? [`${after.name}: ${label(after.object)}`, ...indent(inner, 2)]
        : [];
    }
    if (before.kind === "objects" && after.kind === "objects") {
      const inner = this.ofItems(before.objects, after.objects);
      return inner.length ? [`${after.name}:`, ...indent(inner, 2)] : [];
    }
    return replaced();
  }

  private ofElements(before: ElementsChild, after: ElementsChild): string[] {
    const one = !after.collection && after.elements.length === 1;
    const lines = elementChanges(
      this.reconciled,
      before.elements,
      after.elements,
      one
    );
    if (lines.length === 0) {
      // A child that came to hold nothing, or something again.
      const [old, now] = [linesOf(before), linesOf(after)];
      if (old?.[0] === now?.[0] || !old || !now) return [];
      return [`${after.name}: ${old[0]} → ${now[0]}`];
    }
    // One element whose own line alone changed reads on the child's line.
    if (one && lines.length === 1 && lines[0]!.startsWith("- "))
      return [`${after.name}: ${lines[0]!.slice(2)}`];
    return [`${after.name}:`, ...indent(lines, 2)];
  }

  /**
   * How a collection's Page Objects changed: matched by id, or by position
   * for those without one. One without an id that went away keeps its first
   * child, so the agent can tell which went.
   */
  private ofItems(
    before: readonly PageObjectTreeNode[],
    after: readonly PageObjectTreeNode[]
  ): string[] {
    const matchOf = (node: PageObjectTreeNode, index: number) =>
      node.id
        ? before.find((old) => old.id === node.id)
        : before[index] &&
            !before[index].id &&
            before[index].className === node.className
          ? before[index]
          : undefined;
    const matched = new Set(
      after.flatMap((node, index) => {
        const old = matchOf(node, index);
        return old ? [old] : [];
      })
    );
    const lines: string[] = [];
    for (const old of before)
      if (!matched.has(old)) {
        const first = old.id ? undefined : bodyLines(old)[0];
        lines.push(
          `- ${label(old)} (removed)${first ? `, was: ${first.trim()}` : ""}`
        );
      }
    after.forEach((node, index) => {
      const old = matchOf(node, index);
      if (!old) {
        lines.push(`+ ${label(node)}`, ...indent(bodyLines(node), 4));
        return;
      }
      const inner = this.ofNode(old, node);
      if (inner.length) lines.push(`- ${label(node)}`, ...indent(inner, 4));
    });
    return lines;
  }
}
