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
  membersByRef: ReadonlyMap<string, string>
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
      const member = membersByRef.get(node.ref);
      if (member !== undefined) node.member = member;
    }
    if (header !== "text" && value !== undefined)
      node.children.push(textNode(value));

    (open.at(-1)?.node.children ?? roots).push(node);
    open.push({ indent, node });
  }

  return { roots, refCount };
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
