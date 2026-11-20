import type {
  AriaRef,
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

// How whoever shows a recorder names an element of the page's structure: by
// a label that fits it alone on its page, built as Playwright builds a
// locator. Its role and name; else with the text inside it; else inside its
// nearest ancestor whose label fits that ancestor alone; else with its place
// among its look-alikes. Each label has a Playwright selector of the same
// words, which the page as it is now can be asked for.

/** An element of a tree, as it is named. */
export type NamedElement = {
  /** Its ref in the tree it was read from. */
  readonly ref: AriaRef;
  /** The words that name it, alone on its page if they can. */
  readonly label: string;
  /** Playwright's selector for the same words. */
  readonly selector: string;
};

/** Which page a Change Tree's element is counted against: the page after
 * the change, for an element that appeared or changed, or before it, for
 * one that was removed. A tree that is no Change Tree is one page. */
export type PageView = "after" | "before";

/** An element by its own role and name: its name; for an element with no
 * name and nothing but text inside it, that text, and `byText` says so.
 * Empty for one named by its role only. */
type OwnName = {
  readonly role: string;
  readonly name: string;
  readonly byText: boolean;
};

/** Roles that say nothing of an element. */
const NO_ROLE = new Set(["generic", "none", "presentation", "fragment"]);

/** How much of the text inside an element a label quotes. */
const TEXT_LENGTH = 40;

/** An element by its own role and name, or by its text when it has no name
 * and nothing but text inside it; null for one with no role and no name. */
export function ownName(node: StructuralNode): OwnName | null {
  const { role } = node;
  if (node.name) return { role, name: node.name, byText: false };
  const onlyText = node.children.every((child) => typeof child === "string");
  const text = onlyText ? node.children.join(" ") : "";
  if (text) return { role, name: text, byText: true };
  return NO_ROLE.has(role) ? null : { role, name: "", byText: false };
}

/** The elements inside a node that have a role or a name, the topmost of
 * them, in order. */
export function namedInside(node: StructuralNode): StructuralNode[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string") return [];
    return ownName(child) ? [child] : namedInside(child);
  });
}

/** An element by its label; null for one with no role, no name and no text
 * inside it. */
export function labelOf(
  tree: StructuralTree,
  node: StructuralNode,
  view: PageView = "after"
): NamedElement | null {
  const place = placeOf(tree, node, view);
  return labelsOf(place.tree, place.view).of(place.node);
}

/** An element by its label when it has a role or a name, or else its
 * nearest ancestor that has one; with none, the element by the text inside
 * it. Null when it has no text inside either. */
export function labelNear(
  tree: StructuralTree,
  node: StructuralNode,
  view: PageView = "after"
): NamedElement | null {
  const place = placeOf(tree, node, view);
  const labels = labelsOf(place.tree, place.view);
  const named = [place.node, ...place.tree.getAncestorsOf(place.node.ref)].find(
    (one) => labels.own(one) !== null
  );
  return labels.of(named ?? place.node);
}

/**
 * A step's element in words when no snapshot names it, from its selector: a
 * role and its name, all the selector is, as a label reads them; any other
 * selector in Playwright's own words for it, `locator`; with none of
 * those, "element", never the raw selector. None without a selector.
 */
export function selectorWords(
  selector: string | null,
  locator: string | undefined
): string | undefined {
  if (!selector) return undefined;
  const role =
    /^internal:role=([a-z]+)(?:\[name=("(?:[^"\\]|\\.)*")[is]\])?$/.exec(
      selector
    );
  if (role) return role[2] ? `${role[1]} ${role[2]}` : role[1];
  return locator ?? "element";
}

/** An element in words: its label; "element" for none. */
export const wordsOf = (named: NamedElement | null): string =>
  named ? named.label : "element";

/** The labels of each tree, per page, built once: every row and step of a
 * read asks the one index. */
const built = new WeakMap<StructuralTree, Map<PageView, PageLabels>>();

/** The page before each Change Tree, under the Change Tree's refs: a removed
 * element is counted against it, in its own order. */
const pagesBefore = new WeakMap<StructuralTree, StructuralTree>();

/** Has the labels of a Change Tree's removed elements counted against the
 * page as it was before the change, `before`, under the tree's refs. */
export function withPageBefore(
  change: StructuralTree,
  before: StructuralTree
): StructuralTree {
  pagesBefore.set(change, before);
  return change;
}

function labelsOf(tree: StructuralTree, view: PageView): PageLabels {
  const before = view === "before" ? pagesBefore.get(tree) : undefined;
  if (before) return labelsOf(before, "after");
  let views = built.get(tree);
  if (!views) built.set(tree, (views = new Map()));
  let labels = views.get(view);
  if (!labels) views.set(view, (labels = new PageLabels(tree, view)));
  return labels;
}

/** The tree an element of a Change Tree is labelled in, and the element
 * there: the page before the change for a removed one, when it is known. */
function placeOf(tree: StructuralTree, node: StructuralNode, view: PageView) {
  const before = view === "before" ? pagesBefore.get(tree) : undefined;
  const there = before?.getNode(node.ref);
  return before && there
    ? { tree: before, node: there, view: "after" as const }
    : { tree, node, view };
}

/** One way to name an element: its words, Playwright's selector for them,
 * and the elements of its document that selector matches, in order. */
type Form = {
  readonly words: string;
  readonly selector: string;
  readonly matches: Matches;
};

/** What one selector matches in one document, in order, with each one's
 * place among them. */
type Matches = {
  readonly nodes: readonly StructuralNode[];
  readonly place: ReadonlyMap<AriaRef, number>;
};

/** Roles whose name Playwright takes from the text inside: an element of
 * one with no text of its own in the snapshot holds its name as text. */
const NAMED_BY_CONTENT = new Set([
  "button",
  "cell",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "option",
  "row",
  "rowheader",
  "tab",
  "tooltip",
  "treeitem",
]);

/** The labels of one page: the elements by their role and in order, the
 * text of each as Playwright reads an element's text, and what each
 * selector a label is made of matches, worked out once. */
class PageLabels {
  /** Each element's place in the page, in order. */
  private readonly order = new Map<AriaRef, number>();
  /** The elements of the page, in order. */
  private readonly all: StructuralNode[] = [];
  /** The place just after each element's last descendant: the elements
   * inside one are those placed after it and before that. */
  private readonly ends = new Map<AriaRef, number>();
  /** The elements of each role, in order. */
  private readonly byRole = new Map<string, StructuralNode[]>();
  /** The text inside each element, and directly inside it (`textIn`). */
  private readonly texts = new Map<AriaRef, string>();
  private readonly ownTexts = new Map<AriaRef, string>();
  /** Each element's whole text, as Playwright reads it, and in lower
   * case. */
  private readonly fullTexts = new Map<AriaRef, string>();
  private readonly lowerTexts = new Map<AriaRef, string>();
  /** The frame each element is in; null for the page's own document. */
  private readonly frameByRef = new Map<AriaRef, StructuralNode | null>();
  /** The elements by their whole text, in order. */
  private readonly byFullText = new Map<string, StructuralNode[]>();
  /** The elements of each role by their name, and by their whole text,
   * made when first asked. */
  private readonly byName = new Map<string, Map<string, StructuralNode[]>>();
  private readonly byRoleText = new Map<
    string,
    Map<string, StructuralNode[]>
  >();
  /** What each selector matches, by its document and its words. */
  private readonly matched = new Map<string, Matches>();
  private readonly labels = new Map<AriaRef, NamedElement | null>();

  constructor(
    private readonly tree: StructuralTree,
    private readonly view: PageView
  ) {
    // Returns the longest text piece inside the element, and its whole
    // text.
    const visit = (
      node: StructuralNode,
      frame: StructuralNode | null
    ): { longest: string; full: string } => {
      if (!this.shows(node)) return { longest: "", full: "" };
      this.order.set(node.ref, this.order.size);
      this.all.push(node);
      this.frameByRef.set(node.ref, frame);
      add(this.byRole, this.value(node).role, node);
      const inside = node.role === "iframe" ? node : frame;
      let longest = "";
      const pieces: string[] = [];
      for (const child of node.children) {
        const piece =
          typeof child === "string"
            ? { longest: normal(child), full: normal(child) }
            : visit(child, inside);
        if (piece.longest.length > longest.length) longest = piece.longest;
        if (piece.full) pieces.push(piece.full);
      }
      // On the page before, an element that changed stands as it was, with
      // all that was inside it.
      const before =
        this.view === "before" ? this.tree.getBeforeNode(node.ref) : null;
      if (before) longest = longestIn(before);
      const full = before ? fullTextOf(before) : fullText(node, pieces);
      this.ends.set(node.ref, this.order.size);
      this.texts.set(node.ref, shortened(longest));
      this.ownTexts.set(node.ref, shortened(longestIn(before ?? node, false)));
      this.fullTexts.set(node.ref, full);
      add(this.byFullText, full, node);
      this.lowerTexts.set(node.ref, full.toLowerCase());
      // A frame's document is its own: its text is no text of the frame's.
      return { longest, full: node.role === "iframe" ? "" : full };
    };
    for (const root of tree.getRootNodes()) visit(root, null);
  }

  /** Whether the element is on this page. */
  private shows(node: StructuralNode) {
    return node.status?.kind !== (this.view === "after" ? "removed" : "added");
  }

  /** The element as this page has it: a Change Tree keeps how each changed
   * element stood before. */
  private value(node: StructuralNode) {
    return this.view === "before"
      ? (this.tree.getBeforeNode(node.ref) ?? node)
      : node;
  }

  own(node: StructuralNode): OwnName | null {
    return ownName(this.value(node));
  }

  /** The text inside an element: its longest text piece, which is one
   * text of the page's own, shortened at a word to about `TEXT_LENGTH`
   * characters. An element with no role and no name has only the text
   * directly inside it: one it wraps with the same text is the element of
   * that text, as Playwright's text lookup finds the innermost. */
  private textIn(node: StructuralNode): string {
    return (this.own(node) ? this.texts : this.ownTexts).get(node.ref)!;
  }

  /** What a selector matches in the document `frame`, worked out once: the
   * elements of `candidates` that `fits`, and with `innermost`, only those
   * none of whose descendants fits too, as Playwright's text lookup. */
  private matchesOf(
    selector: string,
    frame: StructuralNode | null,
    candidates: readonly StructuralNode[],
    fits: (node: StructuralNode) => boolean,
    innermost = false
  ): Matches {
    const key = `${frame?.ref ?? ""}\u0000${selector}`;
    const known = this.matched.get(key);
    if (known) return known;
    let nodes = candidates.filter(
      (node) => this.frameOf(node) === frame && fits(node)
    );
    if (innermost)
      nodes = nodes.filter((node, at) => {
        const next = nodes[at + 1];
        return !next || this.order.get(next.ref)! >= this.ends.get(node.ref)!;
      });
    const matches = {
      nodes,
      place: new Map(nodes.map((node, at) => [node.ref, at])),
    };
    this.matched.set(key, matches);
    return matches;
  }

  /** The ways to name an element, plainest first: its role and name, and
   * those with the text inside it. */
  private forms(node: StructuralNode): Form[] {
    const own = this.own(node);
    const frame = this.frameOf(node);
    // A frame has no role Playwright's selectors know, and its document's
    // text is not its own: it is one of the frames of its document.
    if (node.role === "iframe")
      return [
        {
          words: own ? words(own) : "iframe",
          selector: "iframe",
          matches: this.matchesOf(
            "iframe",
            frame,
            this.byRole.get("iframe")!,
            () => true
          ),
        },
      ];
    const forms: Form[] = [];
    const first = own && this.ownForm(own, frame);
    if (first) forms.push(first);
    const text = this.textIn(node);
    if (!text || text === own?.name) return forms;
    const kept = text.replace(/…$/, "");
    const lower = kept.toLowerCase();
    const holds = (one: StructuralNode) =>
      this.lowerTexts.get(one.ref)!.includes(lower);
    if (first) {
      const selector = `${first.selector} >> internal:has-text=${JSON.stringify(kept)}i`;
      forms.push({
        words: `${first.words} ${quotedWords(text)}`,
        selector,
        matches: this.matchesOf(selector, frame, first.matches.nodes, holds),
      });
    } else {
      const selector = `internal:text=${JSON.stringify(kept)}i`;
      forms.push({
        words: quotedWords(text),
        selector,
        matches: this.matchesOf(selector, frame, this.all, holds, true),
      });
    }
    return forms;
  }

  /** An element's form by its own role and name, and what it matches as
   * Playwright does: a name exactly, a role alone any element of the role,
   * and a text of its own exactly. */
  private ownForm(own: OwnName, frame: StructuralNode | null): Form {
    const { role, name } = own;
    const ofRole = this.byRole.get(role) ?? [];
    const quoted = JSON.stringify(name);
    const every = () => true;
    if (!own.byText) {
      const selector = name
        ? `internal:role=${role}[name="${escaped(name)}"s]`
        : `internal:role=${role}`;
      const candidates = name
        ? (this.indexed(
            this.byName,
            role,
            ofRole,
            (one) => this.value(one).name
          ).get(name) ?? [])
        : ofRole;
      return {
        words: words(own),
        selector,
        matches: this.matchesOf(selector, frame, candidates, every),
      };
    }
    if (NO_ROLE.has(role)) {
      const selector = `internal:text=${quoted}s`;
      return {
        words: words(own),
        selector,
        matches: this.matchesOf(
          selector,
          frame,
          this.byFullText.get(name) ?? [],
          every,
          true
        ),
      };
    }
    const selector = `internal:role=${role} >> internal:has-text=${quoted}s`;
    const candidates =
      this.indexed(this.byRoleText, role, ofRole, (one) =>
        this.fullTexts.get(one.ref)!
      ).get(name) ?? [];
    return {
      words: words(own),
      selector,
      matches: this.matchesOf(selector, frame, candidates, every),
    };
  }

  /** The elements of a role by one key of theirs, as `index` keeps them:
   * made once per role, when first asked. */
  private indexed(
    index: Map<string, Map<string, StructuralNode[]>>,
    role: string,
    ofRole: readonly StructuralNode[],
    keyOf: (node: StructuralNode) => string
  ): Map<string, StructuralNode[]> {
    let byKey = index.get(role);
    if (!byKey) {
      index.set(role, (byKey = new Map()));
      for (const node of ofRole) add(byKey, keyOf(node), node);
    }
    return byKey;
  }

  /** The frame an element is in; null for one of the page's own
   * document. */
  private frameOf(node: StructuralNode): StructuralNode | null {
    return this.frameByRef.get(node.ref)!;
  }

  /** The first of an element's forms that fits it alone in its document. */
  private alone(node: StructuralNode): Form | undefined {
    return this.forms(node).find((form) => form.matches.nodes.length === 1);
  }

  of(node: StructuralNode): NamedElement | null {
    if (this.labels.has(node.ref)) return this.labels.get(node.ref)!;
    const named = this.build(node);
    this.labels.set(node.ref, named);
    return named;
  }

  /** How many of `matches` are inside `ancestor`: the elements placed
   * after it and before its end, found by halving. */
  private countInside(matches: Matches, ancestor: StructuralNode): number {
    const from = this.order.get(ancestor.ref)!;
    const to = this.ends.get(ancestor.ref)!;
    const firstAt = (bound: number) => {
      let low = 0;
      let high = matches.nodes.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.order.get(matches.nodes[middle]!.ref)! < bound)
          low = middle + 1;
        else high = middle;
      }
      return low;
    };
    return firstAt(to) - firstAt(from + 1);
  }

  private build(node: StructuralNode): NamedElement | null {
    const forms = this.forms(node);
    const last = forms.at(-1);
    if (!last) return null;
    // A selector reaches into a frame only by entering it.
    const ancestors = this.tree.getAncestorsOf(node.ref);
    const frame = this.frameOf(node);
    const frameAt = frame ? ancestors.indexOf(frame) : -1;
    const framed = (words: string, selector: string): NamedElement => ({
      ref: node.ref,
      label: words,
      selector: frame
        ? `${this.of(frame)!.selector} >> internal:control=enter-frame >> ${selector}`
        : selector,
    });
    const alone = forms.find((form) => form.matches.nodes.length === 1);
    if (alone) return framed(alone.words, alone.selector);
    // Inside the nearest ancestor with a role or a name that fits it alone,
    // when the element is the only one its selector matches in it.
    const within = frameAt === -1 ? ancestors : ancestors.slice(0, frameAt);
    for (const ancestor of within) {
      if (!this.own(ancestor)) continue;
      const theirs = this.alone(ancestor);
      if (!theirs) continue;
      if (this.countInside(last.matches, ancestor) === 1)
        return framed(
          `${theirs.words} › ${last.words}`,
          `${theirs.selector} >> ${last.selector}`
        );
      break;
    }
    // Its place among what its selector matches in its document.
    const at = last.matches.place.get(node.ref) ?? 0;
    return framed(
      `${last.words} (${ordinal(at + 1)} of ${last.matches.nodes.length})`,
      `${last.selector} >> nth=${at}`
    );
  }
}

function add<K>(map: Map<K, StructuralNode[]>, key: K, node: StructuralNode) {
  const nodes = map.get(key);
  if (nodes) nodes.push(node);
  else map.set(key, [node]);
}

/** An element's own role and name in words: its role, unless it says
 * nothing, and its name, quoted. */
const words = (own: OwnName) =>
  [
    ...(NO_ROLE.has(own.role) ? [] : [own.role]),
    ...(own.name ? [quotedWords(own.name)] : []),
  ].join(" ");

/** A text piece with its spaces as a page's text reads them. */
const normal = (piece: string) => piece.replace(/\s+/g, " ").trim();

/** The longest text piece inside an element, all of it, or only directly
 * inside it. */
function longestIn(node: StructuralNode, deep = true): string {
  let text = "";
  for (const child of node.children) {
    const piece =
      typeof child === "string" ? normal(child) : deep ? longestIn(child) : "";
    if (piece.length > text.length) text = piece;
  }
  return text;
}

/** An element's whole text as Playwright reads it: the text inside it,
 * and the name of an element whose name is its text, with spaces as a
 * page's text reads them. */
function fullText(node: StructuralNode, pieces: readonly string[]): string {
  if (pieces.length === 0 && node.name && NAMED_BY_CONTENT.has(node.role))
    return node.name;
  return normal(pieces.join(" "));
}

/** The whole text of an element as it stood, all of it. */
function fullTextOf(node: StructuralNode): string {
  const pieces = node.children.map((child) =>
    typeof child === "string" ? normal(child) : fullTextOf(child)
  );
  return fullText(
    node,
    pieces.filter((piece) => piece)
  );
}

const quotedWords = (text: string) => `"${escaped(text)}"`;

const escaped = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Text cut at the last word that ends within `TEXT_LENGTH` characters,
 * marked by an ellipsis. */
function shortened(text: string): string {
  if (text.length <= TEXT_LENGTH) return text;
  const cut = text.slice(0, TEXT_LENGTH + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut.slice(0, TEXT_LENGTH)).trimEnd()}…`;
}

function ordinal(place: number): string {
  const tens = place % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][place % 10] ?? "th");
  return `${place}${suffix}`;
}
