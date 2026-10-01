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
  children: StructureNode[];
};

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
  membersByRef: ReadonlyMap<string, readonly string[]>
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
    // A property of its parent, such as the Page Objects rooted at it.
    if (header.startsWith("/")) continue;

    const node =
      header === "text" ? textNode(value ?? "") : elementNode(header);
    if (node.ref !== undefined) {
      refCount += 1;
      const members = membersByRef.get(node.ref) ?? [];
      node.members = members;
      const tag = memberTag(members);
      if (tag !== undefined) node.member = tag;
    }
    if (header !== "text" && value !== undefined)
      node.children.push(textNode(value));

    (open.at(-1)?.node.children ?? roots).push(node);
    open.push({ indent, node });
  }

  return { roots, refCount };
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
  for (const token of tokens) {
    if (token.startsWith('"')) name = unquote(token);
    // Roles are lowercase words; a Page Object label is an identifier path.
    else if (/^[a-z]+$/.test(token)) role = token;
  }
  return {
    ...(ref === undefined ? {} : { ref }),
    role,
    name,
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
