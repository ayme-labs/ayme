// Stryker disable all
// The document's one ref world and Ayme's dual capture over it: Playwright's
// pinned snapshot code, with marks, a ref counter and a ref map that only
// this module has, one set per document.
import type { Capture, CapturedRoot, Predicate } from "../../shared";
import { predicates } from "./predicates";

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
 * `ignore` predicate is a function until it takes a selector (#1177).
 */
export type ElementInputs = {
  /** Whether the host leaves `element`, and everything under it, out. */
  ignores?: (element: Element) => boolean;
};

/**
 * What a capture places besides the host's inputs: the host's Page Object
 * Roots as its latest completed probe run found them.
 */
export type CaptureRoots = {
  /** The host's present Page Object Roots, each with its label. */
  roots?: readonly { label: string; element: Element }[];
  /** The host's absent Page Object Roots, whose subtrees it leaves out. */
  absent?: readonly Element[];
};

/** What a host asks of a capture besides the roots and exclusions it hands in. */
export type CaptureAsk = {
  /** The predicates whose accepted refs the capture carries. */
  accepts?: readonly Predicate[];
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

  // An element a capture marked after a probe named it keeps both refs.
  function names(element: Element, ref: string): boolean {
    return (
      marks.get(element)?.ref === ref || syntheticRefs.get(element) === ref
    );
  }

  function elementOf(ref: string): Element | undefined {
    const element = byRef.get(ref)?.deref();
    return element && names(element, ref) ? element : undefined;
  }

  /**
   * Whether `ref` is one the module ever gave `element`: an element's ref
   * changes with its role and name, and a root's synthetic ref gives way to
   * its mark once a capture marks it.
   */
  function everNamed(element: Element, ref: string): boolean {
    return elementEverNamed(ref) === element;
  }

  /** The element `ref` named at any time, if it is still there. */
  function elementEverNamed(ref: string): Element | undefined {
    return byRef.get(ref)?.deref();
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

  function capture(
    root: Element,
    inputs: ElementInputs & CaptureRoots = {},
    ask: CaptureAsk = {}
  ): CaptureBody {
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
    // A root the snapshot left out is named by its synthetic ref, and a
    // predicate keeps it like any element.
    const named = new Map(snapshot.refsByElement);
    const roots = [
      ...referenced,
      ...outerToInner(omitted).map(({ element, labels }): CapturedRoot => {
        const syntheticRef = syntheticRefOf(element);
        named.set(element, syntheticRef);
        return {
          labels,
          syntheticRef,
          descendantRefs: [...snapshot.refsByElement]
            .filter(
              ([candidate]) =>
                candidate !== element && element.contains(candidate)
            )
            .map(([, ref]) => ref),
        };
      }),
    ];

    return {
      distilledText: snapshot.distilledText,
      fullText: snapshot.fullText,
      excludedRefs,
      roots,
      ...(ask.accepts ? { accepted: acceptedBy(ask.accepts, named) } : {}),
    };
  }

  /** The ref that names `element`: its mark's, else a synthetic one, minted when it has none. */
  function nameOf(element: Element): string {
    return marks.get(element)?.ref ?? syntheticRefOf(element);
  }

  return {
    capture,
    elementOf,
    elementEverNamed,
    everNamed,
    nameOf,
    /** The ref a capture gave `element`, if it has one. */
    refOf: (element: Element): string | undefined => marks.get(element)?.ref,
    /** The ref `element` was last captured with, its own or its synthetic one. */
    lastRefOf: (element: Element): string | undefined =>
      marks.get(element)?.ref ?? syntheticRefs.get(element),
    queryRef(ref: string, root?: Node): Element[] {
      const element = elementOf(ref);
      return element?.isConnected && (!root || holds(root, element))
        ? [element]
        : [];
    },
  };
}

/** For each predicate, the refs of the elements it keeps, in capture order. */
function acceptedBy(
  asked: readonly Predicate[],
  refsByElement: ReadonlyMap<Element, string>
): Partial<Record<Predicate, string[]>> {
  const accepted: Partial<Record<Predicate, string[]>> = {};
  for (const predicate of asked) {
    const keeps = predicates[predicate];
    accepted[predicate] = [...refsByElement]
      .filter(([element]) => keeps(element))
      .map(([, ref]) => ref);
  }
  return accepted;
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
