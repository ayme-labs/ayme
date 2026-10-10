// Runtime, not publication: the Page State Session and its
// interaction history import nothing from the publication side (`webMcp.ts`,
// tool schema rendering, anything touching `document.modelContext`); the
// publication side calls in, never the reverse.

import { captureAriaSnapshot } from "@ayme-dev/playwright-lite/internal";
import {
  AriaRefSchema,
  renderCompactStructuralNodeForest,
  projectStructuralNodeForest,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type ProjectedStructuralNode,
  type ProjectedStructuralNodeForest,
  type ProjectedStructuralProperty,
  type StructuralActionId,
  type StructuralIdentityLedger,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import { browserMonotonicClock } from "./browserMonotonicClock";
import { InteractionHistory, type ToolCall } from "./interactionHistory";
import type { Cursor } from "./cursors";
import {
  announceRegisteredPomChange,
  getRegisteredPomStructure,
} from "./registry";
import { containsThroughShadow } from "./pomObstruction";

import {
  placeCapturedRoots,
  type OmittedCapturedRoot,
  type ReferencedCapturedRoot,
} from "./pomRootPlacement";
import { parseCapturedTree } from "./capturedTree";
import { RuntimeStateError, ToolInputError } from "./errors";

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
};

type CapturedPageState = PageStateCapture & {
  readonly text: string;
  /** The projected forest `text` is rendered from: what the model is shown. */
  readonly projected: ProjectedStructuralNodeForest;
};

/**
 * A capture that recorded nothing: its tree, element map, rendered text and
 * the projected forest the text is rendered from.
 */
export type PageStateLook = CapturedPageState;

/**
 * Package-internal: a projected node's own entry in the page state text, as
 * the text renders it: its lines (its line, then its properties, without the
 * entries nested under it) and how many entries nest under it.
 */
export function pageStateNodeEntry(node: ProjectedStructuralNode): {
  lines: string[];
  childCount: number;
} {
  const lines = renderCompactStructuralNodeForest({ roots: [node] }).split(
    "\n"
  );
  return {
    lines: lines.slice(0, 1 + node.properties.length),
    // A node rendered on one line has its one text, if any, on that line.
    childCount: lines.length === 1 ? 0 : node.children.length,
  };
}

const pageStateSessions = new WeakMap<Document, PageStateSession>();

/**
 * Marks an Inspector host mounted for dogfooding: the panel is then part of
 * the page agents see.
 */
export const INSPECTOR_DOGFOOD_ATTRIBUTE = "data-ayme-inspector-dogfood";

/** Package-internal: the Inspector's host, unless it is mounted for dogfooding. */
export const INSPECTOR_HOST_SELECTOR = `[data-ayme-inspector-host]:not([${INSPECTOR_DOGFOOD_ATTRIBUTE}])`;

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

/**
 * Capture the page state. `cursor` is the reader that receives it, whose
 * cursor moves to the capture: the "before" of its next Change Record. A
 * capture nobody receives moves no cursor.
 */
export async function getPageStateForDocument(
  currentDocument: Document,
  cursor?: Cursor
): Promise<PageState> {
  return getPageStateSession(currentDocument).getPageState(cursor);
}

/**
 * Package-internal: capture the current page state and return its typed data.
 * `cursor` is the reader that receives the capture, whose cursor moves to it:
 * the "before" of its next Change Record.
 */
export async function getPageStateCaptureForDocument(
  currentDocument: Document,
  options: { cursor?: Cursor } = {}
): Promise<PageStateCapture> {
  return getPageStateSession(currentDocument).getPageStateCapture(
    options.cursor
  );
}

/**
 * Capture `currentDocument`'s page state without recording it in the
 * interaction history, for a reader that is not a caller (the Inspector).
 */
export async function lookAtPageStateForDocument(
  currentDocument: Document
): Promise<PageStateLook> {
  return getPageStateSession(currentDocument).look();
}

/**
 * Package-internal: start a Structural Action for a tool call. An action
 * needs a page to compare against, so a session that has observed nothing
 * yet captures once first.
 */
export async function startActionForDocument(
  currentDocument: Document,
  call: ToolCall
): Promise<StructuralActionId> {
  return getPageStateSession(currentDocument).startAction(call);
}

/**
 * Package-internal: the before capture of an action that has started: the
 * page right before its tool runs, recorded as the action's "before"
 * observation only when it differs from the latest observation, so an idle
 * page between two Runs costs no observation. Moves no cursor. Returns the
 * observation when one was recorded.
 */
export async function captureBeforeActionForDocument(
  currentDocument: Document,
  actionId: StructuralActionId
): Promise<StructuralObservationEntry | undefined> {
  return getPageStateSession(currentDocument).captureBefore(actionId);
}

/**
 * Package-internal: complete an action whose tool call threw, with the page as
 * it is now, or as last recorded when capturing it throws. No caller's cursor
 * moves.
 */
export async function failActionForDocument(
  currentDocument: Document,
  actionId: StructuralActionId
): Promise<void> {
  return getPageStateSession(currentDocument).failAction(actionId);
}

/**
 * Package-internal: capture the Settled Page after an action and return that
 * observation, the action's after, where the acting cursor moves. When
 * capturing throws, the action is completed as failed with the page as last
 * recorded, and the error travels on.
 */
export async function completeActionForDocument(
  currentDocument: Document,
  actionId: StructuralActionId
): Promise<StructuralObservationEntry> {
  return getPageStateSession(currentDocument).completeAction(actionId);
}

/**
 * Package-internal: the document's interaction history. Creating it records
 * the document's first Visit, so the runtime opens it on start.
 */
export function getInteractionHistory(
  currentDocument: Document
): InteractionHistory {
  return getPageStateSession(currentDocument).history;
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

/**
 * Package-internal: the Structural Ref an Availability Reason names for
 * `obstruction`, the element a click on `root` would reach instead: the ref
 * the agent's latest recorded page state gave it, or its nearest ancestor
 * that has one and does not hold `root` (what holds the root is not in its
 * way). An obstruction that holds the root, an inert ancestor, is named by
 * its own ref only. Undefined when none has one, as for `<html>` when `body`
 * takes no pointer events.
 */
export function latestRefInTheWay(
  obstruction: Element,
  root: Element
): AriaRef | undefined {
  const session = pageStateSessions.get(obstruction.ownerDocument);
  if (!session) return undefined;
  if (containsThroughShadow(obstruction, root))
    return session.latestRefOf(obstruction);
  for (
    let node: Element | null = obstruction;
    node && !containsThroughShadow(node, root);
    node = parentElement(node)
  ) {
    const ref = session.latestRefOf(node);
    if (ref !== undefined) return ref;
  }
  return undefined;
}

function parentElement(current: Element): Element | null {
  return (
    current.assignedSlot ??
    current.parentElement ??
    (current.getRootNode() as ShadowRoot).host ??
    null
  );
}

function getPageStateSession(currentDocument: Document) {
  let session = pageStateSessions.get(currentDocument);
  if (!session) {
    session = new PageStateSession(currentDocument);
    pageStateSessions.set(currentDocument, session);
  }
  return session;
}

class PageStateSession {
  private readonly refFactory = new SyntheticAriaRefFactory();
  /**
   * Every capture is an observation in it; the observation a cursor stands
   * at is the "before" of its next Change Record, and its identity ledger
   * keeps ref continuity. Captures Ayme makes for itself move no cursor.
   */
  readonly history: InteractionHistory;
  /**
   * The element map of the latest recorded observation. The identity ledger
   * stands at that observation when it is read, so its current refs are
   * looked up here; only this one map is kept, never one per observation.
   */
  private latestElements:
    | {
        observation: StructuralObservationEntry;
        elementsByRef: ReadonlyMap<AriaRef, Element>;
      }
    | undefined;

  constructor(private readonly currentDocument: Document) {
    this.history = new InteractionHistory(
      currentDocument,
      browserMonotonicClock
    );
  }

  async getPageState(cursor?: Cursor): Promise<PageState> {
    return this.pageStateFor(await this.capture(cursor));
  }

  async getPageStateCapture(cursor?: Cursor): Promise<PageStateCapture> {
    return this.capture(cursor);
  }

  /**
   * Capture the page without recording it: no observation, no cursor, no
   * element map. What callers see next is the same as if it never ran. Its
   * `e` refs are the ones the page's next recorded capture gives the same
   * elements; a fresh synthetic-ref factory keeps the `s_` refs a caller
   * sees next from shifting.
   */
  async look(): Promise<PageStateLook> {
    return captureCurrentPageState(
      this.currentDocument.body,
      new SyntheticAriaRefFactory()
    );
  }

  async startAction(call: ToolCall): Promise<StructuralActionId> {
    if (!this.history.hasObservation) await this.capture();
    return this.history.startAction(call);
  }

  async captureBefore(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry | undefined> {
    // Set: starting the action captured when nothing had been observed.
    const latest = this.history.latestObservation!;
    const capture = await this.captureTree();
    const sinceLatest = StructuralTree.reconcile(
      await latest.tree.resolve(),
      capture.tree
    );
    if (!sinceLatest.hasAnyChanges()) return undefined;
    const before = this.history.observeBefore(
      actionId,
      capture.tree,
      this.history.now()
    );
    this.rememberElements(capture);
    return before;
  }

  async completeAction(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry> {
    let capture: CapturedPageState;
    try {
      capture = await this.captureTree();
    } catch (error) {
      await this.failAtLatestObservation(actionId);
      throw error;
    }
    const after = this.history.completeAction(
      actionId,
      capture.tree,
      this.history.now()
    );
    this.rememberElements(capture);
    return after;
  }

  async failAction(actionId: StructuralActionId): Promise<void> {
    let capture: CapturedPageState;
    try {
      capture = await this.captureTree();
    } catch {
      return this.failAtLatestObservation(actionId);
    }
    this.history.failAction(actionId, capture.tree, this.history.now());
    this.rememberElements(capture);
  }

  /** Complete a failed action without a capture, when capturing is what failed. */
  private async failAtLatestObservation(
    actionId: StructuralActionId
  ): Promise<void> {
    // Set since the action started: every recorded observation remembers its
    // elements. Read before awaiting, so the tree and its elements match.
    const latest = this.latestElements!;
    const tree = await latest.observation.tree.resolve();
    this.history.failAction(actionId, tree, this.history.now());
    this.rememberElements(latest);
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

  /** Capture and record an observation; `cursor`, the reader receiving it, moves there. */
  private async capture(cursor?: Cursor): Promise<CapturedPageState> {
    const capture = await this.captureTree();
    // Stamped once the capture is taken, so it cannot share its time with an
    // action started right after it.
    const observation = this.history.observe(capture.tree, this.history.now());
    cursor?.move(observation);
    this.rememberElements(capture);
    return capture;
  }

  /** Call in the same step as the observation of these elements is recorded. */
  private rememberElements({
    elementsByRef,
  }: Pick<CapturedPageState, "elementsByRef">): void {
    this.latestElements = {
      observation: this.history.latestObservation!,
      elementsByRef,
    };
    this.latestRefsByElement = undefined;
    // An Availability Reason names the ref this capture may have just given
    // the element in the way, so the tools are read again.
    announceRegisteredPomChange();
  }

  /** Each element's one ref in the latest recorded observation, built on first use. */
  private latestRefsByElement: ReadonlyMap<Element, AriaRef> | undefined;

  /**
   * The ref the agent's latest page state gave `element`, when it gave it
   * exactly one; undefined before any page state was recorded.
   */
  latestRefOf(element: Element): AriaRef | undefined {
    if (!this.latestElements) return undefined;
    if (!this.latestRefsByElement) {
      const refs = new Map<Element, AriaRef | undefined>();
      for (const [ref, candidate] of this.latestElements.elementsByRef)
        refs.set(candidate, refs.has(candidate) ? undefined : ref);
      this.latestRefsByElement = new Map(
        [...refs].filter(
          (entry): entry is [Element, AriaRef] => entry[1] !== undefined
        )
      );
    }
    return this.latestRefsByElement.get(element);
  }

  /** Capture the page for recording, rejecting a capture the identity ledger could not accept. */
  private async captureTree(): Promise<CapturedPageState> {
    const capture = await captureCurrentPageState(
      this.currentDocument.body,
      this.refFactory
    );
    const duplicateRef = capture.tree.findDuplicateRef();
    if (duplicateRef !== null)
      throw new RuntimeStateError(
        `The page capture gave more than one node the Structural Ref ${duplicateRef}.`
      );
    return capture;
  }

  private pageStateFor(capture: CapturedPageState): PageState {
    return Object.freeze({
      text: capture.text,
      resolve: async (...refs: AriaRef[]) => this.resolveRefs(refs),
    });
  }

  async resolveRefs(refs: readonly AriaRef[]): Promise<RefResolution[]> {
    // A capture Ayme makes for itself: the observation session's identity
    // ledger carries ref identities forward through it without it becoming
    // the state a caller received.
    // The ledger is read at the latest recorded observation, which may be a
    // capture that interleaved after this one; refs and elements are taken
    // from that same observation.
    await this.capture();
    return this.history.observations.readIdentityLedger(
      this.history.pageId,
      (ledger, through) => {
        const latest = this.latestElements;
        if (!latest || latest.observation !== through)
          throw new RuntimeStateError(
            "The identity ledger stands at an observation without an element map."
          );
        return refs.map((requestedRef) =>
          this.resolveOne(ledger, latest.elementsByRef, requestedRef)
        );
      }
    );
  }

  private resolveOne(
    ledger: StructuralIdentityLedger,
    elementsByRef: ReadonlyMap<AriaRef, Element>,
    requestedRef: AriaRef
  ): RefResolution {
    const identity = ledger.resolve(requestedRef);
    if (identity.status === "unresolved") return identity;
    const element = elementsByRef.get(identity.currentRef);
    if (element === undefined)
      return { status: "unresolved", requestedRef, reason: "no-element" };
    return {
      status: "resolved",
      requestedRef,
      node: { ref: identity.currentRef, element },
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

  return { text, projected, tree: currentTree, elementsByRef };
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
