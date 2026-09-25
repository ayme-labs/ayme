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
import { RefResolutionError, ToolInputError } from "./errors";

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

type AdvancedCapture = CapturedPageState & {
  readonly reconcile: StructuralTree | null;
};

type SessionIdentity = {
  currentRef: AriaRef | null;
  currentElement: Element | undefined;
  unresolvedReason: "removed" | "ambiguous" | null;
};

const pageStateSessions = new WeakMap<Document, PageStateSession>();

const INSPECTOR_HOST_SELECTOR = "[data-ayme-inspector-host]";

type PageStateIgnorePredicate = (element: Element) => boolean;

type PageStateIgnoreStore = { ignore?: PageStateIgnorePredicate };

const pageStateIgnoreStore: PageStateIgnoreStore = ((
  globalThis as typeof globalThis & {
    __aymePageStateIgnoreStore?: PageStateIgnoreStore;
  }
).__aymePageStateIgnoreStore ??= {});

/** Package-internal: set while a runtime session is active. */
export function configurePageStateIgnore(
  ignore: PageStateIgnorePredicate | undefined
): void {
  pageStateIgnoreStore.ignore = ignore;
}

function shouldIgnoreElement(element: Element): boolean {
  if (element.matches(INSPECTOR_HOST_SELECTOR)) return true;
  return pageStateIgnoreStore.ignore?.(element) ?? false;
}

function isWithinIgnoredSubtree(element: Element): boolean {
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

export async function getPageStateForDocument(
  currentDocument: Document
): Promise<PageState> {
  return getPageStateSession(currentDocument).getPageState();
}

/**
 * Package-internal: capture the current page state and return its typed data.
 * `forCaller` marks the capture as one the caller receives, so it becomes the
 * "before" of the next Change Record.
 */
export async function getPageStateCaptureForDocument(
  currentDocument: Document,
  options: { forCaller?: boolean } = {}
): Promise<PageStateCapture> {
  return getPageStateSession(currentDocument).getPageStateCapture(
    options.forCaller === true
  );
}

/**
 * Package-internal: capture the Settled Page after an action and reconcile it
 * against the Structural Page State the caller last received; null while the
 * session has no such state. The capture becomes the caller's current state.
 */
export async function captureChangeRecordForDocument(
  currentDocument: Document
): Promise<StructuralTree | null> {
  return getPageStateSession(currentDocument).captureChangeRecord();
}

/**
 * Package-internal: before an action that takes no ref, make sure the session
 * has a state to compare against. Captures only while the caller has received
 * nothing and no capture stands in for it; an existing caller state is kept.
 */
export async function ensureCallerPageState(
  currentDocument: Document
): Promise<void> {
  return getPageStateSession(currentDocument).ensureCallerPageState();
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
    throw new ToolInputError(
      "Page State elements must belong to one Document."
    );
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
  /** The previous capture, against which the next one is reconciled (ADR-0012). */
  private baseline: StructuralTree | null = null;
  /**
   * The Structural Page State the caller last received: the "before" of the
   * next Change Record. Captures Ayme makes for itself do not move it; until
   * the caller has received one, the first capture stands in for it.
   */
  private callerPageState: StructuralTree | null = null;
  private currentIdentitiesByRef = new Map<AriaRef, SessionIdentity>();
  private readonly identitiesByAlias = new Map<AriaRef, SessionIdentity>();

  constructor(private readonly currentRoot: () => Element) {}

  async getPageState(): Promise<PageState> {
    const capture = await this.capture();
    this.callerPageState = capture.tree;
    return this.pageStateFor(capture);
  }

  async getPageStateCapture(forCaller: boolean): Promise<PageStateCapture> {
    const capture = await this.capture();
    if (forCaller) this.callerPageState = capture.tree;
    return capture;
  }

  async ensureCallerPageState(): Promise<void> {
    if (this.callerPageState === null) await this.capture();
  }

  async captureChangeRecord(): Promise<StructuralTree | null> {
    const before = this.callerPageState;
    const capture = await this.capture();
    this.callerPageState = capture.tree;
    return before === null
      ? null
      : StructuralTree.reconcile(before, capture.tree);
  }

  async getPageStateForElements(
    elements: readonly Element[]
  ): Promise<{ state: PageState; refs: (AriaRef | undefined)[] }> {
    const capture = await this.capture();

    return {
      state: this.pageStateFor(capture),
      refs: this.elementRefs(capture, elements),
    };
  }

  private async capture(): Promise<AdvancedCapture> {
    const capture = await captureCurrentPageState(
      this.currentRoot(),
      this.refFactory
    );
    const advanced = { ...capture, ...this.advance(capture) };
    // While the caller has received nothing, the page as Ayme last saw it is
    // the honest "before" of a Change Record.
    this.callerPageState ??= capture.tree;
    return advanced;
  }

  private pageStateFor(capture: CapturedPageState): PageState {
    return Object.freeze({
      text: capture.text,
      resolve: async (...refs: AriaRef[]) => this.resolveRefs(refs),
    });
  }

  async resolveRefs(refs: readonly AriaRef[]): Promise<RefResolution[]> {
    // A capture Ayme makes for itself: it carries ref identities forward
    // (ADR-0012) without becoming the state the caller received.
    await this.capture();
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
      throw new RefResolutionError(
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
      root.contains(registration.element) &&
      !isWithinIgnoredSubtree(registration.element)
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
