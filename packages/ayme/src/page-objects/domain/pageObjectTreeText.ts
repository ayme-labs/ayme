// The Page Object Tree as `page_objects` answers it: the Page Objects on the
// page, nested as their models nest, each declared child that is an element
// shown as its accessibility subtree, and each Page Object that has a root
// with its id. Text only: no Structural Ref, tool name or schema appears.
import type { PageObjectId } from "./pageObjectId";

/** One Page Object in the tree. */
export type PageObjectTreeNode = {
  className: string;
  /** Its Page Object id, when its class has a Page Object Root. */
  id?: PageObjectId;
  children: readonly PageObjectTreeChild[];
};

/**
 * A declared child of a Page Object: elements, as the text after the
 * child's name and the lines below it, or the Page Objects it holds.
 */
export type PageObjectTreeChild =
  | { kind: "elements"; name: string; lines: readonly string[] }
  | { kind: "object"; name: string; object: PageObjectTreeNode }
  | { kind: "objects"; name: string; objects: readonly PageObjectTreeNode[] };

/** How many lines one declared child shows at most. */
export const MAX_CHILD_LINES = 40;
/** How many characters one line shows at most. */
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
      const [first = "", ...rest] = child.lines;
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
