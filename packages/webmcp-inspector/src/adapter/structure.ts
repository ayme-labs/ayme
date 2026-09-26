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
   * The Page Object member whose element this node is, as a path from the
   * Page, e.g. "ListPage.addItemButton" or "ListPage.items[1]".
   */
  member?: string;
  /**
   * The Page Object that owns {@link member}, by path: the object itself
   * when the node is its root, e.g. "ListPage.items[1]", else the object
   * the member is declared on, e.g. "ListPage".
   */
  owner?: string;
  children: StructureNode[];
};

/** The member a ref maps to, with the Page Object that owns it. */
export type MemberMapping = { member: string; owner: string };

/**
 * The member a registry target path names, and the Page Object that owns
 * it. A Page Object's root is listed as `<object>.root`: it is that object,
 * which owns it. Any other member belongs to the object it is declared on.
 */
export function memberOfTarget(path: string): MemberMapping {
  const member = path.replace(/\.root$/, "");
  if (member !== path) return { member, owner: member };
  return { member, owner: path.slice(0, path.lastIndexOf(".")) };
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
  membersByRef: ReadonlyMap<string, string | MemberMapping>
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
      const mapping = membersByRef.get(node.ref);
      if (typeof mapping === "string") node.member = mapping;
      else if (mapping !== undefined) Object.assign(node, mapping);
    }
    if (header !== "text" && value !== undefined)
      node.children.push(textNode(value));

    (open.at(-1)?.node.children ?? roots).push(node);
    open.push({ indent, node });
  }

  return { roots, refCount };
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
  return { role: "text", name: text, children: [] };
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
  return { ...(ref === undefined ? {} : { ref }), role, name, children: [] };
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
