import {
  StructuralTree,
  type AriaRef,
  type StructuralActionId,
  type StructuralIdentityLedger,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import { RuntimeStateError } from "../shared";
import type { Cursor } from "./cursors";
import type { InteractionHistory, ToolCall } from "./interactionHistory";
import {
  renderPageState,
  sameLabels,
  type PageCapture,
  type PageState,
  type PageStateLook,
  type RefResolution,
} from "./structuralPageState";

/**
 * The Page State Session's port: a capture of the page as it is now. Every
 * capture of one session comes from one port, so a Page Object Root keeps
 * its synthetic ref across them, recorded or not.
 */
export type CapturePage = () => Promise<PageCapture>;

/**
 * A document's Page State Session: what it records of each capture and what
 * it answers from them. It reads the page only through `capturePage`.
 */
export class PageStateSession {
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
  private readonly recordedListeners = new Set<() => void>();

  /**
   * `history`: every capture is an observation in it; the observation a
   * cursor stands at is the "before" of its next Change Record, and its
   * identity ledger keeps ref continuity. Captures Ayme makes for itself
   * move no cursor.
   */
  constructor(
    readonly history: InteractionHistory,
    private readonly capturePage: CapturePage
  ) {}

  async getPageState(cursor?: Cursor): Promise<PageState> {
    return this.pageStateFor(await this.capture(cursor));
  }

  async getPageStateCapture(cursor?: Cursor): Promise<PageCapture> {
    return this.capture(cursor);
  }

  /**
   * Capture the page without recording it: no observation, no cursor, no
   * element map. What callers see next is the same as if it never ran. Its
   * refs, `e` and `s_` alike, are the ones the page's next recorded capture
   * gives the same elements, so a tool run on a ref the look printed acts on
   * the element it showed.
   */
  async look(): Promise<PageStateLook> {
    const capture = await this.capturePage();
    return { ...capture, ...renderPageState(capture) };
  }

  /**
   * Start a Structural Action for a tool call. An action needs a page to
   * compare against, so a session that has observed nothing yet captures
   * once first.
   */
  async startAction(call: ToolCall): Promise<StructuralActionId> {
    if (!this.history.hasObservation) await this.capture();
    return this.history.startAction(call);
  }

  /**
   * The before capture of an action that has started: the page right before
   * its tool runs, recorded as the action's "before" observation only when
   * it differs from the latest observation, so an idle page between two Runs
   * costs no observation. Moves no cursor. Returns the observation when one
   * was recorded.
   */
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
    // A Page Object registered or unregistered without the DOM changing
    // still makes a before: a removed root is labelled by it.
    if (
      !sinceLatest.hasAnyChanges() &&
      sameLabels(this.history.pomLabels(latest), capture.pomLabels, sinceLatest)
    )
      return undefined;
    const before = this.history.observeBefore(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomLabels
    );
    this.rememberElements(capture);
    return before;
  }

  /**
   * Capture the Settled Page after an action and return that observation,
   * the action's after, where the acting cursor moves. When capturing
   * throws, the action is completed as failed with the page as last
   * recorded, and the error travels on.
   */
  async completeAction(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry> {
    let capture: PageCapture;
    try {
      capture = await this.captureTree();
    } catch (error) {
      await this.failAtLatestObservation(actionId);
      throw error;
    }
    const after = this.history.completeAction(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomLabels
    );
    this.rememberElements(capture);
    return after;
  }

  /**
   * Complete an action whose tool call threw, with the page as it is now, or
   * as last recorded when capturing it throws, and return that observation,
   * the failed action's after. No caller's cursor moves.
   */
  async failAction(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry> {
    let capture: PageCapture;
    try {
      capture = await this.captureTree();
    } catch {
      return this.failAtLatestObservation(actionId);
    }
    const after = this.history.failAction(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomLabels
    );
    this.rememberElements(capture);
    return after;
  }

  /** Complete a failed action without a capture, when capturing is what failed. */
  private async failAtLatestObservation(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry> {
    // Set since the action started: every recorded observation remembers its
    // elements. Read before awaiting, so the tree and its elements match.
    const latest = this.latestElements!;
    const tree = await latest.observation.tree.resolve();
    const after = this.history.failAction(
      actionId,
      tree,
      this.history.now(),
      this.history.pomLabels(latest.observation)
    );
    this.rememberElements(latest);
    return after;
  }

  /**
   * Capture and record the page, and give each of `elements` its one ref
   * in that capture; an element the capture gave no ref, or several, gets
   * none.
   */
  async getPageStateForElements(
    elements: readonly Element[]
  ): Promise<{ state: PageState; refs: (AriaRef | undefined)[] }> {
    const capture = await this.capture();

    return {
      state: this.pageStateFor(capture),
      refs: elementRefs(capture, elements),
    };
  }

  /** Capture and record an observation; `cursor`, the reader receiving it, moves there. */
  private async capture(cursor?: Cursor): Promise<PageCapture> {
    const capture = await this.captureTree();
    // Stamped once the capture is taken, so it cannot share its time with an
    // action started right after it.
    const observation = this.history.observe(
      capture.tree,
      this.history.now(),
      capture.pomLabels
    );
    cursor?.move(observation);
    this.rememberElements(capture);
    return capture;
  }

  /** Call in the same step as the observation of these elements is recorded. */
  private rememberElements({
    elementsByRef,
  }: Pick<PageCapture, "elementsByRef">): void {
    this.latestElements = {
      observation: this.history.latestObservation!,
      elementsByRef,
    };
    this.latestRefsByElement = undefined;
    for (const listener of this.recordedListeners) listener();
  }

  /**
   * Calls `listener` each time a page state is recorded, until the returned
   * function is called.
   */
  onRecorded(listener: () => void): () => void {
    this.recordedListeners.add(listener);
    return () => {
      this.recordedListeners.delete(listener);
    };
  }

  /**
   * Each element's one ref in the latest recorded observation, built on
   * first use; an element the page state gave several refs maps to undefined.
   */
  private latestRefsByElement:
    ReadonlyMap<Element, AriaRef | undefined> | undefined;

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
      this.latestRefsByElement = refs;
    }
    return this.latestRefsByElement.get(element);
  }

  /** The element the latest recorded page state maps `ref` to, if any. */
  latestElementOf(ref: AriaRef): Element | undefined {
    return this.latestElements?.elementsByRef.get(ref);
  }

  /** Capture the page for recording, rejecting a capture the identity ledger could not accept. */
  private async captureTree(): Promise<PageCapture> {
    const capture = await this.capturePage();
    const duplicateRef = capture.tree.findDuplicateRef();
    if (duplicateRef !== null)
      throw new RuntimeStateError(
        `The page capture gave more than one node the Structural Ref ${duplicateRef}.`
      );
    return capture;
  }

  private pageStateFor(capture: PageCapture): PageState {
    return Object.freeze({
      text: renderPageState(capture).text,
      resolve: async (...refs: AriaRef[]) => this.resolveRefs(refs),
    });
  }

  /** Resolve refs through the session's identity ledger and a fresh capture. */
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
          resolveOne(ledger, latest.elementsByRef, requestedRef)
        );
      }
    );
  }
}

function resolveOne(
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

function elementRefs(
  capture: PageCapture,
  elements: readonly Element[]
): (AriaRef | undefined)[] {
  const refsByElement = new Map<Element, AriaRef[]>();
  for (const [ref, element] of capture.elementsByRef) {
    const refs = refsByElement.get(element) ?? [];
    refs.push(ref);
    refsByElement.set(element, refs);
  }

  return elements.map((element) => {
    const refs = refsByElement.get(element) ?? [];
    return refs.length === 1 ? refs[0] : undefined;
  });
}
