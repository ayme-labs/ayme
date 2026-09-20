import { captureAriaSnapshot } from "@ayme-dev/playwright-lite/internal";
import {
  AriaRefSchema,
  renderCompactStructuralNodeForest,
  projectStructuralNodeForest,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type ProjectedStructuralProperty,
} from "@ayme-dev/core/structural-observation";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import { getRegisteredPomStructure } from "./registry";

import {
  placeCapturedRoots,
  type OmittedCapturedRoot,
  type ReferencedCapturedRoot,
} from "./pomRootPlacement";
import { parseCapturedTree } from "./capturedTree";

const inputSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

export const getPageStateTool = {
  name: "get_page_state",
  description:
    "Return the top-level structural page state, decorated with root POM labels. Real nodes use Playwright refs; synthetic POM roots use observation-only synthetic refs. Capture is limited to the top-level document.",
  inputSchema,
  execute: async () => (await getPageStateForDocument(document)).text,
} satisfies ModelContextTool<Record<string, never>, string>;

export type { AriaRef };

export type AymeNode = {
  ref: AriaRef;
  element: Element;
};

export type RefResolution =
  | {
      status: "resolved";
      requestedRef: AriaRef;
      node: AymeNode;
    }
  | {
      status: "unresolved";
      requestedRef: AriaRef;
      reason: "unknown-ref" | "removed" | "ambiguous" | "no-element";
    };

export type PageState = {
  readonly text: string;
  resolve(...refs: AriaRef[]): Promise<RefResolution[]>;
};

/** Package-internal: typed data from the latest Page State Session capture. */
export type PageStateCapture = {
  readonly tree: StructuralTree;
  readonly elementsByRef: ReadonlyMap<AriaRef, Element>;
  /** Reconcile between the previous and current capture; null on the first capture. */
  readonly reconcile: StructuralTree | null;
};

type CapturedPageState = {
  text: string;
  tree: StructuralTree;
  elementsByRef: ReadonlyMap<AriaRef, Element>;
};

type SessionIdentity = {
  currentRef: AriaRef | null;
  currentElement: Element | undefined;
  unresolvedReason: "removed" | "ambiguous" | null;
};

const pageStateSessions = new WeakMap<Document, PageStateSession>();

export async function getPageStateForDocument(
  currentDocument: Document
): Promise<PageState> {
  return getPageStateSession(currentDocument).getPageState();
}

/** Package-internal: capture the current page state and return its typed data. */
export async function getPageStateCaptureForDocument(
  currentDocument: Document
): Promise<PageStateCapture> {
  return getPageStateSession(currentDocument).getPageStateCapture();
}

/** Resolve refs through the current document's session and a fresh capture. */
export async function resolvePageStateRefs(
  currentDocument: Document,
  ...refs: AriaRef[]
): Promise<RefResolution[]> {
  return getPageStateSession(currentDocument).resolveRefs(refs);
}

export async function resolvePageStateRef(
  element: Element
): Promise<AriaRef | undefined> {
  return getPageStateSession(element.ownerDocument).resolveElementRef(element);
}

export async function getPageStateForElements(
  elements: readonly Element[]
): Promise<{ state: PageState; refs: (AriaRef | undefined)[] }> {
  const currentDocument = elements[0]?.ownerDocument ?? document;
  if (elements.some((element) => element.ownerDocument !== currentDocument))
    throw new Error("Page State elements must belong to one Document.");
  return getPageStateSession(currentDocument).getPageStateForElements(elements);
}

function getPageStateSession(currentDocument: Document) {
  let session = pageStateSessions.get(currentDocument);
  if (!session) {
    session = new PageStateSession(() => currentDocument.body);
    pageStateSessions.set(currentDocument, session);
  }
  return session;
}

class PageStateSession {
  private readonly refFactory = new SyntheticAriaRefFactory();
  private baseline: StructuralTree | null = null;
  private currentIdentitiesByRef = new Map<AriaRef, SessionIdentity>();
  private readonly identitiesByAlias = new Map<AriaRef, SessionIdentity>();

  constructor(private readonly currentRoot: () => Element) {}

  async getPageState(): Promise<PageState> {
    return (await this.getPageStateForElements([])).state;
  }

  async getPageStateCapture(): Promise<PageStateCapture> {
    const capture = await captureCurrentPageState(
      this.currentRoot(),
      this.refFactory
    );
    return this.advance(capture);
  }

  async getPageStateForElements(
    elements: readonly Element[]
  ): Promise<{ state: PageState; refs: (AriaRef | undefined)[] }> {
    const capture = await captureCurrentPageState(
      this.currentRoot(),
      this.refFactory
    );
    this.advance(capture);

    return {
      state: Object.freeze({
        text: capture.text,
        resolve: async (...refs: AriaRef[]) => this.resolveRefs(refs),
      }),
      refs: this.elementRefs(capture, elements),
    };
  }

  async resolveRefs(refs: readonly AriaRef[]): Promise<RefResolution[]> {
    this.advance(
      await captureCurrentPageState(this.currentRoot(), this.refFactory)
    );
    return refs.map((requestedRef) => this.resolveOne(requestedRef));
  }

  private resolveOne(requestedRef: AriaRef): RefResolution {
    const identity = this.identitiesByAlias.get(requestedRef);
    if (!identity)
      return { status: "unresolved", requestedRef, reason: "unknown-ref" };
    if (identity.currentRef === null)
      return {
        status: "unresolved",
        requestedRef,
        reason: identity.unresolvedReason ?? "removed",
      };
    if (identity.currentElement === undefined)
      return { status: "unresolved", requestedRef, reason: "no-element" };
    return {
      status: "resolved",
      requestedRef,
      node: { ref: identity.currentRef, element: identity.currentElement },
    };
  }

  async resolveElementRef(element: Element): Promise<AriaRef | undefined> {
    return (await this.resolveElementRefs([element]))[0];
  }

  async resolveElementRefs(
    elements: readonly Element[]
  ): Promise<(AriaRef | undefined)[]> {
    return (await this.getPageStateForElements(elements)).refs;
  }

  private elementRefs(
    capture: CapturedPageState,
    elements: readonly Element[]
  ): (AriaRef | undefined)[] {
    const refsByElement = new Map<Element, AriaRef[]>();
    for (const [ref, element] of capture.elementsByRef) {
      const refs = refsByElement.get(element) ?? [];
      refs.push(ref);
      refsByElement.set(element, refs);
    }

    return elements.map((element) => {
      if (!element.isConnected) return undefined;
      const refs = refsByElement.get(element) ?? [];
      return refs.length === 1 ? refs[0] : undefined;
    });
  }

  private advance(capture: CapturedPageState): PageStateCapture {
    if (this.baseline === null) {
      this.currentIdentitiesByRef = this.addInitialIdentities(capture);
      this.baseline = capture.tree;
      return {
        tree: capture.tree,
        elementsByRef: capture.elementsByRef,
        reconcile: null,
      };
    }

    const previousIdentitiesByRef = this.currentIdentitiesByRef;
    const reconciled = StructuralTree.reconcile(this.baseline, capture.tree);
    const assignments = capture.tree.getAllNodes().map((node) => {
      const beforeRef = reconciled.getBeforeNodeForAfterRef(node.ref)?.ref;
      const candidates = new Set<SessionIdentity>();
      const currentIdentity = previousIdentitiesByRef.get(node.ref);
      const historicalIdentity = this.identitiesByAlias.get(node.ref);
      const lineageIdentity =
        beforeRef === undefined
          ? undefined
          : previousIdentitiesByRef.get(beforeRef);

      if (currentIdentity) candidates.add(currentIdentity);
      if (historicalIdentity) candidates.add(historicalIdentity);
      if (lineageIdentity) candidates.add(lineageIdentity);

      return {
        node,
        candidates,
        hasAmbiguousCandidate: [...candidates].some(
          (identity) => identity.unresolvedReason === "ambiguous"
        ),
      };
    });
    const claimsByIdentity = new Map<SessionIdentity, number[]>();
    for (const [index, { candidates }] of assignments.entries()) {
      if (candidates.size !== 1) continue;
      const identity = [...candidates][0]!;
      const claims = claimsByIdentity.get(identity) ?? [];
      claims.push(index);
      claimsByIdentity.set(identity, claims);
    }

    const nextIdentitiesByRef = new Map<AriaRef, SessionIdentity>();
    const retainedIdentities = new Set<SessionIdentity>();
    const ambiguousIdentities = new Set<SessionIdentity>();

    for (const { candidates, hasAmbiguousCandidate } of assignments) {
      if (candidates.size > 1 || hasAmbiguousCandidate)
        for (const identity of candidates) ambiguousIdentities.add(identity);
    }
    for (const [identity, claims] of claimsByIdentity) {
      if (claims.length > 1) ambiguousIdentities.add(identity);
    }

    for (const { node, candidates, hasAmbiguousCandidate } of assignments) {
      const identity = candidates.size === 1 ? [...candidates][0] : undefined;
      const claims =
        identity === undefined ? undefined : claimsByIdentity.get(identity);
      if (
        candidates.size > 1 ||
        hasAmbiguousCandidate ||
        (claims !== undefined && claims.length > 1)
      ) {
        if (!this.identitiesByAlias.has(node.ref))
          this.identitiesByAlias.set(node.ref, this.createAmbiguousIdentity());
        continue;
      }

      const selectedIdentity = identity ?? this.createIdentity();
      selectedIdentity.currentRef = node.ref;
      selectedIdentity.currentElement = capture.elementsByRef.get(node.ref);
      selectedIdentity.unresolvedReason = null;
      this.bindAlias(node.ref, selectedIdentity);
      nextIdentitiesByRef.set(node.ref, selectedIdentity);
      retainedIdentities.add(selectedIdentity);
    }

    for (const [beforeRef, identity] of previousIdentitiesByRef) {
      if (retainedIdentities.has(identity)) continue;
      identity.currentRef = null;
      identity.currentElement = undefined;
      identity.unresolvedReason =
        ambiguousIdentities.has(identity) ||
        reconciled.wasBeforeRefAmbiguous(AriaRefSchema.parse(beforeRef))
          ? "ambiguous"
          : "removed";
    }

    this.currentIdentitiesByRef = nextIdentitiesByRef;
    this.baseline = capture.tree;
    return {
      tree: capture.tree,
      elementsByRef: capture.elementsByRef,
      reconcile: reconciled,
    };
  }

  private addInitialIdentities(
    capture: CapturedPageState
  ): Map<AriaRef, SessionIdentity> {
    const identities = new Map<AriaRef, SessionIdentity>();
    for (const node of capture.tree.getAllNodes()) {
      const identity = this.createIdentity();
      identity.currentRef = node.ref;
      identity.currentElement = capture.elementsByRef.get(node.ref);
      this.bindAlias(node.ref, identity);
      identities.set(node.ref, identity);
    }
    return identities;
  }

  private createIdentity(): SessionIdentity {
    return {
      currentRef: null,
      currentElement: undefined,
      unresolvedReason: null,
    };
  }

  private createAmbiguousIdentity(): SessionIdentity {
    return {
      currentRef: null,
      currentElement: undefined,
      unresolvedReason: "ambiguous",
    };
  }

  private bindAlias(ref: AriaRef, identity: SessionIdentity): void {
    const existing = this.identitiesByAlias.get(ref);
    if (existing !== undefined && existing !== identity) {
      throw new Error(
        `Structural Ref alias ${ref} is already bound to another Page State identity.`
      );
    }
    this.identitiesByAlias.set(ref, identity);
  }
}

export async function capturePageState(
  root: Element = document.body
): Promise<string> {
  return (await captureCurrentPageState(root, new SyntheticAriaRefFactory()))
    .text;
}

async function captureCurrentPageState(
  root: Element,
  refFactory: SyntheticAriaRefFactory
): Promise<CapturedPageState> {
  const structure = await getRegisteredPomStructure();
  const registrations = structure.roots.filter(
    (registration) =>
      registration.element.ownerDocument === root.ownerDocument &&
      root.contains(registration.element)
  );
  const capture = captureWithoutInspector(root);
  const absentRoots = new Set(structure.absentElements);
  const presentRoots = new Set(registrations.map(({ element }) => element));
  const excludedRefs = new Set<AriaRef>();
  for (const [element, ref] of capture.refsByElement) {
    for (let ancestor: Element | null = element; ancestor;) {
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

  const inlineLabels = new Map<AriaRef, string>();
  const properties = new Map<AriaRef, ProjectedStructuralProperty[]>();
  for (const [ref, labels] of labelsByRef) {
    const sorted = [...labels].sort();
    const value = sorted.length === 1 ? sorted[0]! : sorted;
    if (
      typeof value === "string" &&
      /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(value)
    )
      inlineLabels.set(ref, value);
    else properties.set(ref, [{ key: "pom", label: "pom", value }]);
  }
  const projected = projectStructuralNodeForest(
    {
      roots: currentTree.getRootNodes(),
      structuralNode: (node) =>
        inlineLabels.has(node.ref) || node.ref.startsWith("s_")
          ? node.copy({ role: "generic" })
          : node,
      children: (node) => node.children,
    },
    {
      includeIdentity: false,
      includeStatus: false,
      prefixes: (node) => [
        node.ref,
        ...(inlineLabels.has(node.ref) ? [inlineLabels.get(node.ref)!] : []),
      ],
      properties: (node) => properties.get(node.ref) ?? [],
    }
  );
  const text = renderCompactStructuralNodeForest(projected);
  const currentRefs = new Set<AriaRef>(currentTree.getAllRefs());
  const elementsByRef = new Map<AriaRef, Element>(elementsBySyntheticRef);
  for (const [element, rawRef] of capture.refsByElement) {
    const ref = AriaRefSchema.parse(rawRef);
    if (currentRefs.has(ref)) elementsByRef.set(ref, element);
  }

  return { text, tree: currentTree, elementsByRef };
}

function captureWithoutInspector(root: Element) {
  const inspectorHosts = [
    ...(root.matches("[data-ayme-inspector-host]") ? [root] : []),
    ...root.querySelectorAll("[data-ayme-inspector-host]"),
  ];
  const previousValues = inspectorHosts.map((host) => ({
    display: (host as HTMLElement).style.getPropertyValue("display"),
    priority: (host as HTMLElement).style.getPropertyPriority("display"),
  }));
  for (const host of inspectorHosts)
    (host as HTMLElement).style.setProperty("display", "none", "important");
  try {
    return captureAriaSnapshot(root);
  } finally {
    inspectorHosts.forEach((host, index) => {
      const previous = previousValues[index]!;
      if (previous.display)
        (host as HTMLElement).style.setProperty(
          "display",
          previous.display,
          previous.priority
        );
      else (host as HTMLElement).style.removeProperty("display");
    });
  }
}

function coalesceByElement(
  roots: readonly { label: string; element: Element }[]
): { element: Element; labels: string[] }[] {
  const seen = new Map<Element, { element: Element; labels: string[] }>();
  for (const root of roots) {
    const existing = seen.get(root.element);
    if (existing) {
      if (!existing.labels.includes(root.label))
        existing.labels.push(root.label);
    } else {
      seen.set(root.element, { element: root.element, labels: [root.label] });
    }
  }
  return [...seen.values()];
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
    ancestorRef,
    descendantRefs,
    role: "generic",
    name: "",
  };
}
