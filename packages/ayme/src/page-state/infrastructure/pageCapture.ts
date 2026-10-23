// The Page State Session's capture of a document: Playwright Lite's ARIA
// snapshot, with ignored subtrees and absent Page Object Roots left out and
// the present roots placed and labelled.

import { captureAriaSnapshot } from "@ayme-dev/playwright-lite/internal";
import {
  AriaRefSchema,
  type AriaRef,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { INSPECTOR_HOST_SELECTOR } from "../../shared";
import { parseCapturedTree } from "../domain/capturedTree";
import {
  coalesceByElement,
  placeCapturedRoots,
  type OmittedCapturedRoot,
  type ReferencedCapturedRoot,
  type SyntheticRootRefFactory,
} from "../domain/pomRootPlacement";
import type { PageCapture } from "../domain/structuralPageState";

/**
 * The Page Object Roots a capture places: present roots are labelled, and
 * absent ones are left out of it.
 */
export type PageObjectStructure = {
  roots: readonly { label: string; element: Element }[];
  absentElements: readonly Element[];
};

/** What a capture reads besides the document, read afresh on each capture. */
export type PageCaptureSources = {
  /** The Page Object Roots to place; undefined while none is registered. */
  pageObjectStructure(): Promise<PageObjectStructure> | undefined;
  /** Whether the app leaves `element`, and everything under it, out. */
  ignores(element: Element): boolean;
};

function isWithinIgnoredSubtree(
  element: Element,
  shouldIgnoreElement: (element: Element) => boolean
): boolean {
  for (let ancestor: Element | null = element; ancestor;) {
    if (shouldIgnoreElement(ancestor)) return true;
    ancestor =
      ancestor.assignedSlot ??
      ancestor.parentElement ??
      (ancestor.getRootNode() as ShadowRoot).host ??
      null;
  }
  return false;
}

/**
 * Capture the page under `root`, minting synthetic refs from `refFactory`,
 * so a root keeps its ref across every capture that shares the factory.
 */
export async function capturePage(
  root: Element,
  refFactory: SyntheticRootRefFactory,
  sources: PageCaptureSources
): Promise<PageCapture> {
  const shouldIgnoreElement = (element: Element) =>
    element.matches(INSPECTOR_HOST_SELECTOR) || sources.ignores(element);
  const structure = (await sources.pageObjectStructure()) ?? {
    roots: [],
    absentElements: [],
  };
  const registrations = structure.roots.filter(
    (registration) =>
      registration.element.ownerDocument === root.ownerDocument &&
      root.contains(registration.element) &&
      !isWithinIgnoredSubtree(registration.element, shouldIgnoreElement)
  );
  const capture = captureAriaSnapshot(root);
  const absentRoots = new Set(structure.absentElements);
  const presentRoots = new Set(registrations.map(({ element }) => element));
  const excludedRefs = new Set<AriaRef>();
  for (const [element, ref] of capture.refsByElement) {
    for (let ancestor: Element | null = element; ancestor;) {
      if (shouldIgnoreElement(ancestor)) {
        excludedRefs.add(AriaRefSchema.parse(ref));
        break;
      }
      if (presentRoots.has(ancestor)) break;
      if (absentRoots.has(ancestor)) {
        excludedRefs.add(AriaRefSchema.parse(ref));
        break;
      }
      ancestor =
        ancestor.assignedSlot ??
        ancestor.parentElement ??
        (ancestor.getRootNode() as ShadowRoot).host ??
        null;
    }
  }
  const retainedTree = parseCapturedTree(
    capture.distilledText,
    refFactory,
    excludedRefs
  );
  const fullTree = parseCapturedTree(
    capture.fullText,
    refFactory,
    excludedRefs
  );

  const coalesced = coalesceByElement(registrations);
  const referenced: {
    candidate: ReferencedCapturedRoot;
    labels: string[];
  }[] = [];
  const omitted: { element: Element; labels: string[] }[] = [];

  for (const entry of coalesced) {
    const rawRef = capture.refsByElement.get(entry.element);
    if (rawRef !== undefined) {
      referenced.push({
        candidate: {
          kind: "referenced",
          ref: AriaRefSchema.parse(rawRef),
        },
        labels: entry.labels,
      });
    } else {
      omitted.push(entry);
    }
  }

  sortOuterToInner(omitted);

  const refPlacement = placeCapturedRoots(
    retainedTree,
    fullTree,
    referenced.map((r) => r.candidate),
    refFactory
  );
  let currentTree = refPlacement.tree;
  const labelsByRef = new Map<AriaRef, string[]>();
  const elementsBySyntheticRef = new Map<AriaRef, Element>();

  for (const [index, ref] of refPlacement.refs.entries()) {
    if (ref === null) continue;
    labelsByRef.set(ref, referenced[index]!.labels);
  }

  for (const entry of omitted) {
    const candidate = omittedCapturedRoot(
      entry.element,
      capture.refsByElement,
      currentTree,
      fullTree
    );
    const placement = placeCapturedRoots(
      currentTree,
      fullTree,
      [candidate],
      refFactory
    );
    currentTree = placement.tree;
    const ref = placement.refs[0] ?? null;
    if (ref !== null) {
      labelsByRef.set(ref, entry.labels);
      elementsBySyntheticRef.set(ref, entry.element);
    }
  }

  const currentRefs = new Set<AriaRef>(currentTree.getAllRefs());
  const elementsByRef = new Map<AriaRef, Element>(elementsBySyntheticRef);
  for (const [element, rawRef] of capture.refsByElement) {
    const ref = AriaRefSchema.parse(rawRef);
    if (currentRefs.has(ref)) elementsByRef.set(ref, element);
  }

  return {
    tree: currentTree,
    elementsByRef,
    pomLabels: labelsByRef,
  };
}

function sortOuterToInner(
  entries: { element: Element; labels: string[] }[]
): void {
  const decorated = entries.map((entry, index) => ({
    entry,
    index,
    depth: entries.filter(
      (other) => other !== entry && other.element.contains(entry.element)
    ).length,
  }));
  decorated.sort((a, b) => a.depth - b.depth || a.index - b.index);
  const sorted = decorated.map((d) => d.entry);
  for (let i = 0; i < entries.length; i++) entries[i] = sorted[i]!;
}

function omittedCapturedRoot(
  element: Element,
  refsByElement: ReadonlyMap<Element, string>,
  currentTree: StructuralTree,
  fullTree: StructuralTree
): OmittedCapturedRoot {
  const fullOrder = new Map(
    fullTree.getAllRefs().map((ref, index) => [ref, index] as const)
  );
  const descendantRefs = [...refsByElement]
    .filter(
      ([candidate]) => candidate !== element && element.contains(candidate)
    )
    .map(([, ref]) => AriaRefSchema.parse(ref))
    .filter((ref) => currentTree.hasNode(ref))
    .sort(
      (left, right) =>
        (fullOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (fullOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
  const ancestorRef = descendantRefs[0]
    ? currentTree
        .getAncestorsOf(descendantRefs[0])
        .find((ancestor) =>
          descendantRefs.every((ref) =>
            currentTree
              .getAncestorsOf(ref)
              .some((candidate) => candidate.ref === ancestor.ref)
          )
        )?.ref
    : undefined;

  return {
    kind: "omitted",
    element,
    ancestorRef,
    descendantRefs,
    role: "generic",
    name: "",
  };
}
