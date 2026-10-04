import type { ControlState } from "./formControls";
import type { PageObjectNode } from "./pageModel";
import {
  indexMembers,
  type IndexedMember,
  type MemberIndex,
} from "./memberIndex";

/**
 * The structure tree model: the Structural Page State an agent receives, as
 * a tree the Inspector can render, search and pick refs from.
 */
export type StructureNode = {
  /** The ref an agent passes to single-element tools. Text has none. */
  ref?: string;
  /** The accessible role: "generic" when the page state names none, "text" for text. */
  role: string;
  /** The accessible name, or the text itself. */
  name: string;
  /**
   * Its states as the page state lists them, e.g. "checked" or "level=1".
   * Rows leave them out; "What the model sees" shows them.
   */
  states?: string[];
  /**
   * A native form control's state, read from the element: what the page
   * state leaves out, such as a slider's range.
   */
  control?: ControlState;
  /**
   * Every Page Object member whose element this node is, by path, in the
   * registry's order: e.g. both "ListPage.items[1]" and "ListPage.entries[1]"
   * when two collections hold the same element. A Page Object's root is the
   * Page Object. Ask this when the question is "is this node X?".
   */
  members: readonly string[];
  /**
   * The member tag: the most specific of `members`, see {@link memberTag}.
   */
  member?: string;
  /**
   * The member tag as a Structure row shows it, kept short: relative to the
   * page, and a collection item as `[·]`, since the node's name tells items
   * apart. So "ListPage.items[1].archiveButton" reads "[·].archiveButton".
   */
  tag?: string;
  /**
   * The members a node's detail lists, the tag first, each with where it
   * leads (see {@link memberLinks}).
   */
  memberLinks?: readonly MemberLink[];
  /**
   * The Page Object instance that owns {@link member}, the tag, by path: the
   * instance itself when the node is its root, e.g. "ListPage.items[1]",
   * else the instance the member is declared on, e.g. "ListPage".
   */
  owner?: string;
  /**
   * What an agent reads of this node alone, for "What the model sees": its
   * own lines of the page state, unindented, e.g.
   * `- e3 checkbox "Done" [checked]`, followed by its properties, such as
   * `  - /pom: ListItem`. Text has none.
   */
  pageStateLines?: string[];
  /** How many entries nest under it in the page state, besides properties. */
  childCount?: number;
  children: StructureNode[];
};

/**
 * Where a member leads: the Page Object instance that owns it, or, for a
 * member of a Page Object Model's group such as "ListItem.nameButton", that
 * Page Object Model.
 */
export type MemberOwner = { object: string } | { model: string };

/** A member of a node, with where it leads. */
export type MemberLink = { member: string; owner: MemberOwner };

const noMembers = indexMembers({ objects: [], models: [] });

export type StructureTree = {
  roots: readonly StructureNode[];
  /** How many nodes carry a ref. */
  refCount: number;
};

export const emptyStructure: StructureTree = { roots: [], refCount: 0 };

/**
 * Builds the tree from the page state text an agent receives, in its compact
 * notation (`- e3 button "Add item"`), and tags each node with the members
 * whose element its ref is.
 */
export function buildStructureTree(
  text: string,
  /** The registry targets' paths whose element each ref is, by ref. */
  targetsByRef: ReadonlyMap<string, readonly string[]>,
  /** The page model's members, which the targets are. */
  index: MemberIndex = noMembers,
  /** The native form controls' states, by ref. */
  controls: ReadonlyMap<string, ControlState> = new Map()
): StructureTree {
  const roots: StructureNode[] = [];
  const open: { indent: number; node: StructureNode }[] = [];
  let refCount = 0;

  for (const line of text.split("\n")) {
    const match = /^(\s*)- (.*)$/.exec(line);
    if (!match) continue;
    const indent = match[1]!.length;
    while (open.length && open.at(-1)!.indent >= indent) open.pop();

    const { header, value } = splitEntry(match[2]!);
    const parent = open.at(-1)?.node;
    // A property of its parent, such as the Page Objects rooted at it.
    if (header.startsWith("/")) {
      parent?.pageStateLines?.push(`  - ${match[2]!}`);
      continue;
    }
    if (parent?.childCount !== undefined) parent.childCount += 1;

    const node =
      header === "text" ? textNode(value ?? "") : elementNode(header);
    if (header !== "text") {
      node.pageStateLines = [`- ${match[2]!}`];
      node.childCount = 0;
    }
    if (node.ref !== undefined) {
      refCount += 1;
      const control = controls.get(node.ref);
      if (control) node.control = control;
      const members = [
        ...new Map(
          (targetsByRef.get(node.ref) ?? []).flatMap((target) => {
            const member = index.member(target);
            return member ? [[member.path, member] as const] : [];
          })
        ).values(),
      ];
      node.members = members.map(({ path }) => path);
      const tag = memberTag(members, index);
      if (tag !== undefined) {
        node.member = tag.path;
        node.tag = shortTag(tag, index);
        node.memberLinks = memberLinks(members, tag, index);
        node.owner = tag.owner.path;
      }
    }
    if (header !== "text" && value !== undefined)
      node.children.push(textNode(value));

    (parent?.children ?? roots).push(node);
    open.push({ indent, node });
  }

  return { roots, refCount };
}

/**
 * The members a node's detail lists, the tag first, then in the registry's
 * order, each leading to the instance that owns it. After each member come
 * the Page Object Model groups it is in, outermost first, each leading to its
 * model: "ListItem.nameButton" for a ListItem's nameButton, or
 * "List.items.button" for the button of an Item in a List's items.
 */
export function memberLinks(
  members: readonly IndexedMember[],
  tag: IndexedMember,
  index: MemberIndex
): MemberLink[] {
  const links = new Map<string, MemberOwner>();
  const add = (member: string, owner: MemberOwner) => {
    if (!links.has(member)) links.set(member, owner);
  };
  add(tag.path, { object: tag.owner.path });
  for (const member of members) {
    add(member.path, { object: member.owner.path });
    for (const group of modelGroups(member, index))
      add(group.path, { model: group.className });
  }
  return [...links].map(([member, owner]) => ({ member, owner }));
}

/**
 * The Page Object Model groups a member is in, outermost first: one for each
 * component or item that holds it, by that model's name and the members
 * down to it, with no item indices.
 */
function modelGroups(member: IndexedMember, index: MemberIndex) {
  const groups: { className: string; path: string }[] = [];
  const names = member.locator ? [member.locator.name] : [];
  for (
    let node: PageObjectNode | undefined = member.owner;
    node && node.kind !== "page";
    node = index.parent(node)
  ) {
    if (node.kind !== "collection")
      groups.unshift({
        className: node.className,
        path: [node.className, ...names].join("."),
      });
    if (node.kind !== "item") names.unshift(node.name);
  }
  return groups;
}

/** A page model node and its ancestors, nearest first. */
function ancestry(node: PageObjectNode, index: MemberIndex) {
  const nodes: PageObjectNode[] = [];
  for (
    let current: PageObjectNode | undefined = node;
    current;
    current = index.parent(current)
  )
    nodes.push(current);
  return nodes;
}

/** A node as a row of the tree, depth first, with its depth from a root. */
export type StructureRow = { node: StructureNode; depth: number };

/** Every node of the tree, depth first, the way the page state lists them. */
export function* structureRows(
  nodes: readonly StructureNode[],
  depth = 0
): Generator<StructureRow> {
  for (const node of nodes) {
    yield { node, depth };
    yield* structureRows(node.children, depth + 1);
  }
}

function textNode(text: string): StructureNode {
  return { role: "text", name: text, members: [], children: [] };
}

/**
 * A node's header: its ref, the Page Object label of a root, the role (left
 * out when generic), the quoted name and its states in brackets.
 */
function elementNode(header: string): StructureNode {
  const [ref, ...tokens] = header.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  let role = "generic";
  let name = "";
  const states: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('"')) name = unquote(token);
    else if (/^\[.+\]$/.test(token)) states.push(token.slice(1, -1));
    // Roles are lowercase words; a Page Object label is an identifier path.
    else if (/^[a-z]+$/.test(token)) role = token;
  }
  return {
    ...(ref === undefined ? {} : { ref }),
    role,
    name,
    ...(states.length ? { states } : {}),
    members: [],
    children: [],
  };
}

/** Splits `header: value` at the first colon outside quotes. */
function splitEntry(entry: string): { header: string; value?: string } {
  let quoted = false;
  let index = 0;
  for (; index < entry.length; index += 1) {
    const char = entry[index];
    if (quoted && char === "\\") index += 1;
    else if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) break;
  }
  const value = entry.slice(index + 1).trim();
  return {
    header: entry.slice(0, index).trim(),
    ...(value ? { value: unquote(value) } : {}),
  };
}

function unquote(text: string) {
  if (!text.startsWith('"')) return text;
  try {
    return String(JSON.parse(text));
  } catch {
    return text.slice(1, -1);
  }
}

/**
 * The one member tag for a node that several members locate: the most
 * specific one, inside the most collection items, then the deepest, then the
 * first the registry lists. So an item's member beats the item, and of two
 * collections over the same element the first registered shows.
 */
export function memberTag(
  members: readonly IndexedMember[],
  index: MemberIndex
): IndexedMember | undefined {
  let best: IndexedMember | undefined;
  let bestRank = -1;
  for (const member of members) {
    const rank = specificity(member, index);
    if (rank > bestRank) [best, bestRank] = [member, rank];
  }
  return best;
}

function specificity({ owner, locator }: IndexedMember, index: MemberIndex) {
  const nodes = ancestry(owner, index);
  const items = nodes.filter(({ kind }) => kind === "item").length;
  return items * 1000 + nodes.length + (locator ? 1 : 0);
}

/**
 * A member tag kept short: its path below the page, with the page's own
 * collection item as `[·]`. A page's root is the page.
 */
function shortTag(member: IndexedMember, index: MemberIndex) {
  const nodes = ancestry(member.owner, index).reverse().slice(1);
  if (!nodes.length && !member.locator) return member.path;
  const [first, second] = nodes;
  const segments = nodes.map(({ kind, name }) =>
    kind === "item" ? name : `.${name}`
  );
  if (first?.kind === "collection" && second?.kind === "item")
    segments.splice(0, 2, "[·]");
  if (member.locator) segments.push(`.${member.locator.name}`);
  return segments.join("");
}

/**
 * Maps each ref to the path of every registry target whose element it is, in
 * the registry's order. Only an element with exactly one ref in the page
 * state maps.
 */
export function mapTargetsToRefs(
  elementsByRef: Iterable<readonly [string, Element]>,
  targets: Iterable<{ path: string; element: Element }>
): Map<string, string[]> {
  const refsByElement = new Map<Element, string[]>();
  for (const [ref, element] of elementsByRef)
    refsByElement.set(element, [...(refsByElement.get(element) ?? []), ref]);
  const targetsByRef = new Map<string, string[]>();
  for (const { element, path } of targets) {
    const refs = refsByElement.get(element);
    if (refs?.length !== 1) continue;
    const paths = targetsByRef.get(refs[0]!) ?? [];
    if (!paths.includes(path)) paths.push(path);
    targetsByRef.set(refs[0]!, paths);
  }
  return targetsByRef;
}
