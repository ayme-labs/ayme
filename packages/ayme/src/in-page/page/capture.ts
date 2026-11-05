// Stryker disable all
// The document's one ref world and Ayme's dual capture over it: Playwright's
// pinned snapshot code, with marks, a ref counter and a ref map that only
// this module has, one set per document.
import type { Capture, CapturedRoot } from "../../shared";

/** A mark: the ref an element got, kept while its role and name stay. */
export type Mark = { role: string; name: string; ref: string };

/**
 * Playwright's dual capture (virtual:ayme-aria-snapshot), marking elements
 * in `aymeRefs.marks` and counting refs with `aymeRefs.next`.
 */
export type CaptureAriaSnapshot = (
  root: Element,
  options: {
    mode: "ai";
    aymeRefs: { marks: WeakMap<Element, Mark>; next(): number };
  }
) => {
  distilledText: string;
  fullText: string;
  refsByElement: Map<Element, string>;
};

/**
 * What a host hands a capture as live values in the page. Transitional: the
 * browser runtime's Page Object Roots and `ignore` predicate are elements and
 * a function until the registry probes in the page (#1175) and `ignore`
 * takes a selector (#1177).
 */
export type ElementInputs = {
  /** The host's present Page Object Roots, each with its label. */
  roots?: readonly { label: string; element: Element }[];
  /** The host's absent Page Object Roots, whose subtrees it leaves out. */
  absent?: readonly Element[];
  /** Whether the host leaves `element`, and everything under it, out. */
  ignores?: (element: Element) => boolean;
};

type CaptureBody = Omit<Capture, "document" | "url">;

/** One document's ref world, capturing with `captureAriaSnapshot`. */
export function createRefWorld(captureAriaSnapshot: CaptureAriaSnapshot) {
  const marks = new WeakMap<Element, Mark>();
  const syntheticRefs = new WeakMap<Element, string>();
  // Every ref ever minted in this document, to the element it names.
  const byRef = new Map<string, WeakRef<Element>>();
  let lastRef = 0;
  let lastSyntheticRef = 0;
  const aymeRefs = { marks, next: () => ++lastRef };

  function names(element: Element, ref: string): boolean {
    return (marks.get(element)?.ref ?? syntheticRefs.get(element)) === ref;
  }

  function elementOf(ref: string): Element | undefined {
    const element = byRef.get(ref)?.deref();
    return element && names(element, ref) ? element : undefined;
  }

  /** The root's synthetic ref, minted once per element and counted per document. */
  function syntheticRefOf(element: Element): string {
    let ref = syntheticRefs.get(element);
    if (ref === undefined) {
      ref = `s_${++lastSyntheticRef}`;
      syntheticRefs.set(element, ref);
      byRef.set(ref, new WeakRef(element));
    }
    return ref;
  }

  function capture(root: Element, inputs: ElementInputs = {}): CaptureBody {
    const ignores = (element: Element) => inputs.ignores?.(element) ?? false;
    const present = (inputs.roots ?? []).filter(
      ({ element }) =>
        element.ownerDocument === root.ownerDocument &&
        root.contains(element) &&
        !ancestry(element).some(ignores)
    );
    const snapshot = captureAriaSnapshot(root, { mode: "ai", aymeRefs });
    for (const [element, ref] of snapshot.refsByElement)
      byRef.set(ref, new WeakRef(element));

    const presentElements = new Set(present.map(({ element }) => element));
    const absentElements = new Set(inputs.absent ?? []);
    const excludedRefs: string[] = [];
    for (const [element, ref] of snapshot.refsByElement)
      for (const ancestor of ancestry(element)) {
        if (ignores(ancestor)) {
          excludedRefs.push(ref);
          break;
        }
        if (presentElements.has(ancestor)) break;
        if (absentElements.has(ancestor)) {
          excludedRefs.push(ref);
          break;
        }
      }

    const referenced: CapturedRoot[] = [];
    const omitted: { element: Element; labels: string[] }[] = [];
    for (const { element, labels } of coalesceByElement(present)) {
      const ref = snapshot.refsByElement.get(element);
      if (ref !== undefined) referenced.push({ labels, ref });
      else omitted.push({ element, labels });
    }
    const roots = [
      ...referenced,
      ...outerToInner(omitted).map(({ element, labels }): CapturedRoot => ({
        labels,
        syntheticRef: syntheticRefOf(element),
        descendantRefs: [...snapshot.refsByElement]
          .filter(
            ([candidate]) =>
              candidate !== element && element.contains(candidate)
          )
          .map(([, ref]) => ref),
      })),
    ];

    return {
      distilledText: snapshot.distilledText,
      fullText: snapshot.fullText,
      excludedRefs,
      roots,
    };
  }

  return {
    capture,
    elementOf,
    queryRef(ref: string, root?: Node): Element[] {
      const element = elementOf(ref);
      return element?.isConnected && (!root || holds(root, element))
        ? [element]
        : [];
    },
  };
}

/** `element` and its ancestors, across slots and shadow roots. */
function ancestry(element: Element): Element[] {
  const elements: Element[] = [];
  for (let ancestor: Element | null = element; ancestor;) {
    elements.push(ancestor);
    ancestor =
      ancestor.assignedSlot ??
      ancestor.parentElement ??
      ((ancestor.getRootNode() as ShadowRoot).host as Element | undefined) ??
      null;
  }
  return elements;
}

/** `root` holds `element` when it is an ancestor across shadow roots. */
function holds(root: Node, element: Element): boolean {
  for (let node: Node | null = element; node;)
    if (node === root) return true;
    else node = node instanceof ShadowRoot ? node.host : node.parentNode;
  return false;
}

/** One entry per element: an element several roots share carries each label once. */
function coalesceByElement(
  roots: readonly { label: string; element: Element }[]
): { element: Element; labels: string[] }[] {
  const seen = new Map<Element, { element: Element; labels: string[] }>();
  for (const { label, element } of roots) {
    const existing = seen.get(element);
    if (!existing) seen.set(element, { element, labels: [label] });
    else if (!existing.labels.includes(label)) existing.labels.push(label);
  }
  return [...seen.values()];
}

/** Outer roots first; roots at one depth keep their order. */
function outerToInner<T extends { element: Element }>(entries: T[]): T[] {
  const depth = (entry: T) =>
    entries.filter(
      (other) => other !== entry && other.element.contains(entry.element)
    ).length;
  return entries
    .map((entry, index) => ({ entry, index, depth: depth(entry) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ entry }) => entry);
}
