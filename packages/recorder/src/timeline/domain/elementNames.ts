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
  return labelsOf(tree, view).of(node);
}

/** An element by its label when it has a role or a name, or else its
 * nearest ancestor that has one; with none, the element by the text inside
 * it. Null when it has no text inside either. */
export function labelNear(
  tree: StructuralTree,
  node: StructuralNode,
  view: PageView = "after"
): NamedElement | null {
  const labels = labelsOf(tree, view);
  const named = [node, ...tree.getAncestorsOf(node.ref)].find(
    (one) => labels.own(one) !== null
  );
  return labels.of(named ?? node);
}

/** An element in words: its label; "element" for none. */
export const wordsOf = (named: NamedElement | null): string =>
  named ? named.label : "element";

/** The labels of each tree, per page, built once: every row and step of a
 * read asks the one index. */
const built = new WeakMap<StructuralTree, Map<PageView, PageLabels>>();

function labelsOf(tree: StructuralTree, view: PageView): PageLabels {
  let views = built.get(tree);
  if (!views) built.set(tree, (views = new Map()));
  let labels = views.get(view);
  if (!labels) views.set(view, (labels = new PageLabels(tree, view)));
  return labels;
}

/** One way to name an element, with the elements of the page it fits. */
type Form = {
  readonly words: string;
  readonly selector: string;
  readonly alike: readonly StructuralNode[];
};

/** The labels of one page: an index of the elements by the words of their
 * own role and name, and, asked for, by those and the text inside them. */
class PageLabels {
  /** Each element's place in the page, in order. */
  private readonly order = new Map<AriaRef, number>();
  /** The place just after each element's last descendant: the elements
   * inside one are those placed after it and before that. */
  private readonly ends = new Map<AriaRef, number>();
  /** The elements by the words of their own role and name; "" for those
   * with neither. */
  private readonly byWords = new Map<string, StructuralNode[]>();
  /** The elements of a group of `byWords` by the text inside them. */
  private readonly byText = new Map<string, Map<string, StructuralNode[]>>();
  /** The text inside each element, and directly inside it (`textIn`). */
  private readonly texts = new Map<AriaRef, string>();
  private readonly ownTexts = new Map<AriaRef, string>();
  /** The frame each element is in; null for the page's own document. */
  private readonly frameByRef = new Map<AriaRef, StructuralNode | null>();
  /** The frames of the page, in order. */
  private readonly frames: StructuralNode[] = [];
  private readonly labels = new Map<AriaRef, NamedElement | null>();

  constructor(
    private readonly tree: StructuralTree,
    private readonly view: PageView
  ) {
    // Returns the longest text piece inside the element.
    const visit = (
      node: StructuralNode,
      frame: StructuralNode | null
    ): string => {
      if (!this.shows(node)) return "";
      this.order.set(node.ref, this.order.size);
      this.frameByRef.set(node.ref, frame);
      const own = this.own(node);
      add(this.byWords, own ? words(own) : "", node);
      if (node.role === "iframe") this.frames.push(node);
      const inside = node.role === "iframe" ? node : frame;
      let text = "";
      for (const child of node.children) {
        const piece =
          typeof child === "string" ? normal(child) : visit(child, inside);
        if (piece.length > text.length) text = piece;
      }
      // On the page before, an element that changed stands as it was, with
      // all that was inside it.
      const before =
        this.view === "before" ? this.tree.getBeforeNode(node.ref) : null;
      if (before) text = longestIn(before);
      this.ends.set(node.ref, this.order.size);
      this.texts.set(node.ref, shortened(text));
      this.ownTexts.set(node.ref, shortened(longestIn(before ?? node, false)));
      return text;
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

  /** The elements of the group `group` of `byWords` whose text inside is
   * `text`. */
  private withText(group: string, text: string): StructuralNode[] {
    let texts = this.byText.get(group);
    if (!texts) {
      this.byText.set(group, (texts = new Map()));
      for (const node of this.byWords.get(group)!)
        add(texts, this.textIn(node), node);
    }
    return texts.get(text) ?? [];
  }

  /** The ways to name an element, plainest first: its role and name, and
   * those with the text inside it. */
  private forms(node: StructuralNode): Form[] {
    const own = this.own(node);
    // A frame has no role Playwright's selectors know, and its document's
    // text is not its own: it is one of the frames of its document.
    if (node.role === "iframe") {
      const document = this.frameOf(node);
      return [
        {
          words: own ? words(own) : "iframe",
          selector: "iframe",
          alike: this.frames.filter((one) => this.frameOf(one) === document),
        },
      ];
    }
    const forms: Form[] = [];
    const group = own ? words(own) : "";
    if (own)
      forms.push({
        words: group,
        selector: selectorOf(own),
        alike: this.byWords.get(group)!,
      });
    const text = this.textIn(node);
    if (!text || text === own?.name) return forms;
    const quoted = `"${escaped(text.replace(/…$/, ""))}"`;
    const label = own ? `${group} ${quotedWords(text)}` : quotedWords(text);
    forms.push({
      words: label,
      selector: own
        ? `${selectorOf(own)} >> internal:has-text=${quoted}i`
        : `internal:text=${quoted}i`,
      // Shown alike: an element whose own name reads the same counts too.
      alike: this.inOrder([
        ...this.withText(group, text),
        ...(this.byWords.get(label) ?? []),
      ]),
    });
    return forms;
  }

  private inOrder(nodes: StructuralNode[]) {
    return nodes.sort(
      (one, other) => this.order.get(one.ref)! - this.order.get(other.ref)!
    );
  }

  /** The frame an element is in; null for one of the page's own
   * document. */
  private frameOf(node: StructuralNode): StructuralNode | null {
    return this.frameByRef.get(node.ref)!;
  }

  /** The first of an element's forms that fits it alone on the page. */
  private alone(node: StructuralNode): Form | undefined {
    return this.forms(node).find((form) => form.alike.length === 1);
  }

  of(node: StructuralNode): NamedElement | null {
    if (this.labels.has(node.ref)) return this.labels.get(node.ref)!;
    const named = this.build(node);
    this.labels.set(node.ref, named);
    return named;
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
    const alone = forms.find((form) => form.alike.length === 1);
    if (alone) return framed(alone.words, alone.selector);
    // Inside the nearest ancestor with a role or a name that fits it alone,
    // when the element is the only one of its look-alikes in it.
    const within = frameAt === -1 ? ancestors : ancestors.slice(0, frameAt);
    for (const ancestor of within) {
      if (!this.own(ancestor)) continue;
      const theirs = this.alone(ancestor);
      if (!theirs) continue;
      const from = this.order.get(ancestor.ref)!;
      const to = this.ends.get(ancestor.ref)!;
      const inside = last.alike.filter((one) => {
        const at = this.order.get(one.ref)!;
        return at > from && at < to;
      });
      if (inside.length === 1)
        return framed(
          `${theirs.words} › ${last.words}`,
          `${theirs.selector} >> ${last.selector}`
        );
      break;
    }
    // Its place on the page; the selector counts in its own document.
    const at = last.alike.indexOf(node);
    const inDocument = last.alike.filter((one) => this.frameOf(one) === frame);
    return framed(
      `${last.words} (${ordinal(at + 1)} of ${last.alike.length})`,
      `${last.selector} >> nth=${inDocument.indexOf(node)}`
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

/** Playwright's selector for an element's own role and name, by their exact
 * words; for an element with no role but its text, by that text. */
function selectorOf(own: OwnName): string {
  const quoted = `"${escaped(own.name)}"`;
  if (!own.byText)
    return own.name
      ? `internal:role=${own.role}[name=${quoted}s]`
      : `internal:role=${own.role}`;
  return NO_ROLE.has(own.role)
    ? `internal:text=${quoted}s`
    : `internal:role=${own.role} >> internal:has-text=${quoted}i`;
}

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
