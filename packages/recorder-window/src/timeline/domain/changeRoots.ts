/** One root of what changed, as the window lists it. */
export type ChangeRoot = {
  readonly kind: "added" | "removed" | "changed";
  /** The element in the page structure's words: its role, its name or text
   * and its states, such as `button "Pay" [disabled]`. */
  readonly element: string;
};

const NODE = /^( *)- (.*)$/;
const TOKEN = /^<([a-z]+)> */;
const KINDS = new Set(["added", "removed", "changed"]);

/**
 * The roots of what changed, in the order of the page: of the nodes a
 * Change Tree marks as added, removed or changed, those with no marked node
 * above them. A Change Tree marks every node that changed; the window lists
 * only the topmost, as the released window does. The tree is text in the
 * Recording Package's compact notation: one node per line, two spaces of
 * indent per level, its marks first.
 */
export function changeRoots(changeTree: string): ChangeRoot[] {
  const roots: ChangeRoot[] = [];
  /** The depth of the root being listed: nodes deeper than it are inside it. */
  let inside: number | null = null;
  for (const line of changeTree.split("\n")) {
    const match = NODE.exec(line);
    if (!match) continue;
    // Its indent: only which node is deeper matters.
    const depth = match[1]!.length;
    if (inside !== null && depth > inside) continue;
    inside = null;
    let rest = match[2]!;
    let kind: ChangeRoot["kind"] | undefined;
    for (let token = TOKEN.exec(rest); token; token = TOKEN.exec(rest)) {
      if (KINDS.has(token[1]!)) kind = token[1] as ChangeRoot["kind"];
      rest = rest.slice(token[0].length);
    }
    if (!kind) continue;
    roots.push({ kind, element: describe(rest) });
    inside = depth;
  }
  return roots;
}

/** A node's header without its ref, with its one text after it quoted as a
 * name is. */
function describe(header: string): string {
  const colon = colonOutsideQuotes(header);
  const head = colon < 0 ? header : header.slice(0, colon);
  const text = colon < 0 ? "" : header.slice(colon + 1).trim();
  const words = head.replace(/\[ref=[^\]]*\] ?/, "");
  const value = text.replace(
    // Stryker disable next-line Regex: the notation quotes a text whole or not at all, so either anchor alone matches the same
    /^"(.*)"$/,
    "$1"
  );
  const quoted = value ? `"${value}"` : "";
  const element = [words, quoted].filter(Boolean).join(" ");
  return element === "" ? "element" : element;
}

/** Where the colon that ends a node's header is, or -1: a colon inside a
 * quoted name is part of the name. */
function colonOutsideQuotes(header: string): number {
  let quoted = false;
  for (
    let index = 0;
    // Stryker disable next-line EqualityOperator: one past the end reads undefined, which is no colon
    index < header.length;
    index += 1
  ) {
    const char = header[index];
    if (char === "\\") index += 1;
    else if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) return index;
  }
  return -1;
}
