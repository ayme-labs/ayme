import type { PageModel, PageObjectNode } from "./pageModel";

/**
 * The structure tree model: the Structural Page State an agent receives, as
 * a tree the Inspector can render, search and pick refs from.
 */
export type StructureNode = {
  /** The ref an agent passes to Ref tools. Text has none. */
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
   * Every Page Object member path whose element this node is, in the
   * registry's order: e.g. both "ListPage.items[1]" and "ListPage.entries[1]"
   * when two collections hold the same element, plus the registry's alias
   * paths for it (such as "ListPage.items" or "ListItem"). Ask this when the
   * question is "is this node X?", e.g. through {@link collectionItems}.
   */
  members: readonly string[];
  /**
   * The member tag a Structure row shows: the most specific of `members`,
   * see {@link memberTag}.
   */
  member?: string;
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
 * path through a class name such as "ListItem.nameButton", that Page Object
 * Model.
 */
export type MemberOwner = { object: string } | { model: string };

/** A member of a node, with where it leads. */
export type MemberLink = { member: string; owner: MemberOwner };

/**
 * The page model, indexed to find where a member leads: its Page Object
 * nodes by path, each node's parent, and the Page Object Models by class
 * name and by member path ("ListItem.nameButton").
 */
export type MemberOwners = {
  nodes: ReadonlyMap<string, PageObjectNode>;
  parents: ReadonlyMap<PageObjectNode, PageObjectNode>;
  models: ReadonlyMap<string, string>;
};

const noOwners: MemberOwners = {
  nodes: new Map(),
  parents: new Map(),
  models: new Map(),
};

/** Indexes the page model, once per update, for {@link memberLinks}. */
export function memberOwnersOf({ objects, models }: PageModel): MemberOwners {
  const nodes = new Map<string, PageObjectNode>();
  const parents = new Map<PageObjectNode, PageObjectNode>();
  const visit = (
    children: readonly PageObjectNode[],
    parent?: PageObjectNode
  ) => {
    for (const node of children) {
      // Two registrations of one page class share their paths: the first wins.
      if (!nodes.has(node.path)) nodes.set(node.path, node);
      if (parent) parents.set(node, parent);
      visit(node.children, node);
    }
  };
  visit(objects);
  const modelsByPath = new Map<string, string>();
  for (const { className, members } of models) {
    modelsByPath.set(className, className);
    for (const { path } of members) modelsByPath.set(path, className);
  }
  return { nodes, parents, models: modelsByPath };
}

export type StructureTree = {
  roots: readonly StructureNode[];
  /** How many nodes carry a ref. */
  refCount: number;
};

export const emptyStructure: StructureTree = { roots: [], refCount: 0 };

/**
 * Builds the tree from the page state text an agent receives, in its compact
 * notation (`- e3 button "Add item"`), and tags each node with the member
 * mapped to its ref.
 */
export function buildStructureTree(
  text: string,
  membersByRef: ReadonlyMap<string, readonly string[]>,
  /** The page model's Page Objects and models; they own the members. */
  owners: MemberOwners = noOwners
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
      const members = membersByRef.get(node.ref) ?? [];
      node.members = members;
      const tag = memberTag(members);
      if (tag !== undefined) {
        node.member = tag;
        node.memberLinks = memberLinks(members, tag, owners);
        const owner = instanceOwner(tag, owners)?.owner.path;
        if (owner !== undefined) node.owner = owner;
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
 * The members a node's detail lists, the tag first, each with where it
 * leads, found in the page model:
 *
 * - A member leads to the nearest instance (page, component or item) up its
 *   path when that instance holds the tag: the tag's owner or one of its
 *   ancestors.
 * - A path through the class of a component or item that holds the tag
 *   ("ListItem", "ListItem.nameButton") leads to that model, even when a
 *   page of that class is on the page too.
 * - Any other member leads to its instance, such as another page's member
 *   over the same element or a second collection's item, or else to its
 *   model.
 * - A member through a collection ("ListPage.items" or
 *   "ListPage.items.nameButton" beside "ListPage.items[0]...") is an alias
 *   that adds nothing beyond its item, so it is left out when another
 *   member is in one of the collection's items.
 * - A member the page model doesn't know (yet) is left out.
 */
export function memberLinks(
  members: readonly string[],
  tag: string,
  owners: MemberOwners
): MemberLink[] {
  const ordered = [tag, ...members.filter((member) => member !== tag)];
  const instances = new Map(
    ordered.map((member) => [member, instanceOwner(member, owners)])
  );
  const holdsTag = new Set(ancestry(instances.get(tag)?.owner, owners));
  // A class alias comes from a component or item of that class.
  const aliasedClasses = new Set(
    [...holdsTag]
      .filter((node) => node.kind !== "page")
      .map((node) => node.className)
  );
  const listed = [...instances.values()].flatMap((instance) =>
    ancestry(instance?.owner, owners)
  );

  return ordered.flatMap((member): MemberLink[] => {
    const instance = instances.get(member);
    const model = nearest(member, owners.models);
    const classAlias =
      model !== undefined &&
      (!instance ||
        (!holdsTag.has(instance.owner) && aliasedClasses.has(model)));
    if (classAlias) return [{ member, owner: { model } }];
    if (!instance) return [];
    const aliasOfItem = instance.collections.some((collection) =>
      listed.some((node) => owners.parents.get(node) === collection)
    );
    return aliasOfItem
      ? []
      : [{ member, owner: { object: instance.owner.path } }];
  });
}

/** A page model node and its ancestors, nearest first. */
function ancestry(node: PageObjectNode | undefined, owners: MemberOwners) {
  const nodes: PageObjectNode[] = [];
  for (; node; node = owners.parents.get(node)) nodes.push(node);
  return nodes;
}

/**
 * The nearest instance up a member's path in the page model, and the
 * collections between them.
 */
function instanceOwner(member: string, owners: MemberOwners) {
  const collections: PageObjectNode[] = [];
  let node = nearest(member, owners.nodes);
  for (; node?.kind === "collection"; node = owners.parents.get(node))
    collections.push(node);
  return node && { owner: node, collections };
}

/** The value of the path or of its nearest ancestor path that has one. */
function nearest<Value>(path: string, byPath: ReadonlyMap<string, Value>) {
  for (let current = path; ;) {
    const value = byPath.get(current);
    if (value !== undefined) return value;
    // "ListPage.items[0].nameButton" → "ListPage.items[0]" → "ListPage.items".
    const parent = current.replace(/(?:\.[^.[]*|\[\d+\])$/, "");
    if (parent === current) return undefined;
    current = parent;
  }
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
 * specific path, with the most collection indices, then the most segments,
 * then the first the registry lists. So an item beats its collection and its
 * class ("ListPage.items[1]" over "ListPage.items" and "ListItem"), and of
 * two collections over the same element the first registered shows.
 */
export function memberTag(members: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const path of members)
    if (best === undefined || specificity(path) > specificity(best))
      best = path;
  return best;
}

function specificity(path: string) {
  const indices = path.match(/\[\d+\]/g)?.length ?? 0;
  const segments = path.split(/\.|\[/).length;
  return indices * 1000 + segments;
}

/** A collection's item on the page. */
export type CollectionItem = {
  /** Its concrete path, e.g. "ListPage.items[0].tags[1]". */
  path: string;
  /** Its index in its own collection: 1 for "items[0].tags[1]". */
  index: number;
  /** Every index along the path, outermost first: [0, 1] above. */
  indices: number[];
  ref: string;
};

/**
 * The items of a collection member on the page: every node that is an item
 * of it, whatever else it also is. `collection` names the collection:
 *
 * - "ListPage.items" (or "ListPage.items[]"): the page's items.
 * - "ListPage.items[].tags": the tags of every item, across all items.
 * - "ListPage.items[0].tags": the tags of items[0] only.
 *
 * Items come in index order, outermost index first.
 */
export function collectionItems(
  structure: StructureTree,
  collection: string
): CollectionItem[] {
  const levels = collection.replace(/\[\]$/, "").split("[]");
  const pattern = new RegExp(
    `^${levels.map(escapeRegExp).join("\\[(\\d+)\\]")}\\[(\\d+)\\]$`
  );
  const items = new Map<string, CollectionItem>();
  const visit = (nodes: readonly StructureNode[]) => {
    for (const node of nodes) {
      if (node.ref !== undefined)
        for (const path of node.members) {
          const match = pattern.exec(path);
          if (!match || items.has(path)) continue;
          const indices = match.slice(1).map(Number);
          items.set(path, {
            path,
            index: indices.at(-1)!,
            indices,
            ref: node.ref,
          });
        }
      visit(node.children);
    }
  };
  visit(structure.roots);
  return [...items.values()].sort((a, b) =>
    compareIndices(a.indices, b.indices)
  );
}

function compareIndices(a: readonly number[], b: readonly number[]) {
  for (let level = 0; level < Math.min(a.length, b.length); level += 1)
    if (a[level] !== b[level]) return a[level]! - b[level]!;
  return a.length - b.length;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Maps each ref to every Page Object member whose element it is, in the
 * registry's order, with a component's ".root" folded into the component.
 * Only an element with exactly one ref in the page state maps.
 */
export function mapMembersToRefs(
  elementsByRef: Iterable<readonly [string, Element]>,
  targets: Iterable<{ path: string; element: Element }>
): Map<string, string[]> {
  const refsByElement = new Map<Element, string[]>();
  for (const [ref, element] of elementsByRef)
    refsByElement.set(element, [...(refsByElement.get(element) ?? []), ref]);
  const membersByRef = new Map<string, string[]>();
  for (const { element, path } of targets) {
    const refs = refsByElement.get(element);
    if (refs?.length !== 1) continue;
    const members = membersByRef.get(refs[0]!) ?? [];
    const member = path.replace(/\.root$/, "");
    if (!members.includes(member)) members.push(member);
    membersByRef.set(refs[0]!, members);
  }
  return membersByRef;
}
