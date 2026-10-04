import {
  pageStateNodeEntry,
  type ProjectedStructuralNode,
  type ProjectedStructuralNodeForest,
} from "@ayme-dev/ayme/internal";

import type { ControlState } from "./formControls";
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
   * Its states, such as `checked` or `level`, when the page state sets any.
   * Rows leave them out; "What the model sees" shows them.
   */
  state?: ProjectedStructuralNode["state"];
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
 * Builds the tree from the projected page state, the forest the text an
 * agent receives is rendered from, and tags each node with the members whose
 * element its ref is.
 */
export function buildStructureTree(
  projected: ProjectedStructuralNodeForest,
  /** The registry targets' paths whose element each ref is, by ref. */
  targetsByRef: ReadonlyMap<string, readonly string[]>,
  /** The page model's members, which the targets are. */
  index: MemberIndex = noMembers,
  /** The native form controls' states, by ref. */
  controls: ReadonlyMap<string, ControlState> = new Map()
): StructureTree {
  let refCount = 0;
  const build = (entry: ProjectedStructuralNode | string): StructureNode => {
    if (typeof entry === "string") return textNode(entry);
    refCount += 1;
    const { lines, childCount } = pageStateNodeEntry(entry);
    const hasState = Object.values(entry.state).some(
      (value) => value !== undefined
    );
    const node: StructureNode = {
      ref: entry.ref,
      role: entry.role,
      name: entry.name,
      ...(hasState ? { state: entry.state } : {}),
      members: [],
      pageStateLines: lines,
      childCount,
      children: entry.children.map(build),
    };
    const control = controls.get(entry.ref);
    if (control) node.control = control;
    const members = [
      ...new Map(
        (targetsByRef.get(entry.ref) ?? []).flatMap((target) => {
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
    return node;
  };
  const roots = projected.roots.map(build);
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
  for (const node of index.ancestors(member.owner)) {
    if (node.kind === "page") break;
    if (node.kind !== "collection")
      groups.unshift({
        className: node.className,
        path: [node.className, ...names].join("."),
      });
    if (node.kind !== "item") names.unshift(node.name);
  }
  return groups;
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
  const nodes = index.ancestors(owner);
  const items = nodes.filter(({ kind }) => kind === "item").length;
  return items * 1000 + nodes.length + (locator ? 1 : 0);
}

/**
 * A member tag kept short: its path below the page, with the page's own
 * collection item as `[·]`. A page's root is the page.
 */
function shortTag(member: IndexedMember, index: MemberIndex) {
  const nodes = [...index.ancestors(member.owner)].reverse().slice(1);
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
