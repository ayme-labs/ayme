import {
  StructuralTree,
  type AriaRef,
  type StructuralActionId,
  type StructuralIdentityLedger,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import {
  isJsonValue,
  RuntimeStateError,
  type ActionOutcome,
  type Capture,
} from "../../shared";
import {
  attachChangeRecord,
  readChangeRecord,
  type ActionResult,
  type ChangeRecordStarts,
} from "../domain/actionResult";
import { structureCapture, treeRefAllocator } from "../domain/capturedPage";
import type { Cursor } from "../domain/cursors";
import type {
  InteractionHistory,
  ToolCall,
} from "../domain/interactionHistory";
import {
  renderPageState,
  sameRootMarks,
  type PageCapture,
  type PageState,
  type AymeNode,
  type PageStateLook,
  type PageStateCapture,
  type RefResolution,
} from "../domain/structuralPageState";
import { resolveRequestedRef } from "./refResolution";

/**
 * The Page State Session's port: a capture of the page as it is now, as
 * plain data from the document's in-page module, whose refs, synthetic ones
 * included, are the document's own, whoever captures.
 */
export type CapturePage = () => Promise<Capture>;

/**
 * Transitional (#1182): the elements a capture's refs name, for the browser
 * consumers that still look an element up by ref (Reach, the element tools,
 * the Goal Loop's questions, the Inspector). A ref it does not answer has no
 * element.
 */
export type ElementsOf = (
  refs: readonly AriaRef[]
) => ReadonlyMap<AriaRef, Element>;

/**
 * The Page State Session's port for its actions: `begin` captures the page
 * right before an action, and its `perform` runs the action, waits for a
 * Settled Page, bounded by a deadline, and captures it, or answers at once
 * when the action starts a full page load.
 */
export type ActionPage = {
  begin(): Promise<PageAction>;
};

/** An action begun on the page: the page right before it, and the action. */
export type PageAction = {
  readonly before: Capture;
  /** Never throws what `perform` throws: that comes back as `threw`. */
  perform<T>(perform: () => T | Promise<T>): Promise<ActionOutcome<T>>;
};

/**
 * A document's Page State Session: what it records of each capture and what
 * it answers from them, and the actions it runs. It reads the page only
 * through `captureDocument` and `actionPage`.
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
        tree: StructuralTree;
      }
    | undefined;
  private readonly recordedListeners = new Set<() => void>();
  // The synthetic refs this session's trees mint for themselves.
  private readonly refFactory = treeRefAllocator();

  /**
   * `history`: every capture is an observation in it; the observation a
   * cursor stands at is the "before" of its next Change Record, and its
   * identity ledger keeps ref continuity. Captures Ayme makes for itself
   * move no cursor.
   */
  constructor(
    readonly history: InteractionHistory,
    private readonly captureDocument: CapturePage,
    private readonly actionPage: ActionPage,
    private readonly elementsOf: ElementsOf = () => new Map()
  ) {}

  /** A capture of the page as the session reads it: its tree, marks and elements. */
  private async capturePage(): Promise<PageCapture> {
    return this.read(await this.captureDocument());
  }

  /** `capture` as the session reads it: its tree, marks and elements. */
  private read(capture: Capture): PageCapture {
    const { tree, pomRootMarks } = structureCapture(capture, this.refFactory);
    return {
      tree,
      pomRootMarks,
      elementsByRef: this.elementsOf(tree.getAllRefs()),
    };
  }

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
   * Run `perform` as an action: record a Structural Action around it, wait
   * for a Settled Page, capture it and return the unified action result with
   * the Change Record in two parts: `changes_before`, what changed between
   * the Structural Page State `cursor` stands at, the one its Caller last
   * received, and the page right before the action; and `changes`, what
   * changed from there to the Settled Page after the action, where `cursor`
   * then moves.
   *
   * A Caller's state is what it received: `snapshot` and the Settled Page of
   * its previous action; each step's tree for the Goal Loop's fork. Captures
   * Ayme makes for itself move no cursor: the before capture, taken right
   * before `perform` and recorded only when the page differs from the latest
   * observation, is one. A change that happened on its own since the Caller
   * last read the page, or by another Caller, is therefore in
   * `changes_before`; one that lands while the page settles after the action
   * counts as the action's.
   *
   * An action whose `perform` throws is completed as failed with the page
   * once it settled, and the error travels on; so is one whose before
   * capture, settle wait or after capture throws, with the page as it is
   * then. The error's message then ends with the Change Record's parts that
   * have a change, and `cursor` moves to that page, as the Caller received
   * it: what a failed action did still reaches its Caller once. Where
   * capturing that page throws, the page as last recorded stands in for it.
   *
   * An action that starts a full page load answers at once, before the old
   * document goes away, with the Change Record up to the old document's
   * last capture, the URL that is loading and `next`. `perform` and the
   * settle wait are left to finish on their own; their outcome is never
   * reported. A navigation that stays in the document leaves the action to
   * settle as usual.
   */
  async runAction(
    cursor: Cursor,
    call: ToolCall,
    perform: () => unknown
  ): Promise<ActionResult> {
    const actionId = await this.startAction(call);
    const history = this.history;
    // The start of the Change Record: where the cursor stands as the action
    // starts; child Runs inside the action move the cursor on.
    const received = history.received(cursor);
    // The page as last observed: the action's before unless the before
    // capture finds the page moved on since.
    let before = history.latestObservation;
    let outcome: ActionOutcome<unknown>;
    try {
      const action = await this.actionPage.begin();
      before = (await this.recordBefore(actionId, action.before)) ?? before;
      outcome = await action.perform(perform);
    } catch (error) {
      // The page as it is now, or as last recorded when capturing it throws.
      const after = await this.captureTree().catch(() => undefined);
      await this.fail(actionId, cursor, { received, before }, error, after);
      throw error;
    }

    if (outcome.kind === "loading")
      return this.loadingResult(
        actionId,
        cursor,
        { received, before },
        outcome.url,
        outcome.after
      );
    if (outcome.kind === "threw") {
      const after = this.checkedOrNone(outcome.after);
      await this.fail(
        actionId,
        cursor,
        { received, before },
        outcome.error,
        after
      );
      throw outcome.error;
    }

    const after = await this.completeAction(actionId, outcome.after);
    cursor.move(after);
    const record = await readChangeRecord(history, { received, before }, after);

    const out: ActionResult = {
      page_changed: record.page_changed,
      settled: outcome.stable,
    };

    if (outcome.result !== undefined && isJsonValue(outcome.result))
      out.result = outcome.result;
    if (record.changes_before) out.changes_before = record.changes_before;
    if (record.changes) out.changes = record.changes;

    return out;
  }

  /**
   * Complete an action that threw with the page after it, or as last
   * recorded without one, and give `error` the Change Record's parts that
   * have a change: what a failed action did reaches its Caller once, and
   * `cursor` moves there. An error that cannot take the fields, such as a
   * frozen one, leaves the cursor where it was: the next action reports
   * these changes.
   */
  private async fail(
    actionId: StructuralActionId,
    cursor: Cursor,
    starts: ChangeRecordStarts,
    error: unknown,
    capture: PageCapture | undefined
  ): Promise<void> {
    await this.failAction(actionId, capture)
      .then(async (after) => {
        if (!(error instanceof Error)) return;
        const record = await readChangeRecord(this.history, starts, after);
        attachChangeRecord(error, record);
        cursor.move(after);
      })
      .catch(() => {});
  }

  /**
   * The answer to an action that started a full load of `url`, with the
   * old document's last capture, when it could take one, as its after.
   */
  private async loadingResult(
    actionId: StructuralActionId,
    cursor: Cursor,
    starts: ChangeRecordStarts,
    url: string,
    capture: Capture | undefined
  ): Promise<ActionResult> {
    // The document may already be gone; the answer goes out regardless.
    const record = await (
      capture === undefined
        ? Promise.reject(new Error("The old document left no capture."))
        : this.completeAction(actionId, capture)
    )
      .then((after) => {
        cursor.move(after);
        return readChangeRecord(this.history, starts, after);
      })
      .catch(
        (): Pick<
          ActionResult,
          "page_changed" | "changes_before" | "changes"
        > => ({
          page_changed: false,
        })
      );
    return {
      page_changed: record.page_changed,
      settled: false,
      ...(record.changes_before
        ? { changes_before: record.changes_before }
        : {}),
      ...(record.changes ? { changes: record.changes } : {}),
      loading: url,
      next: `The page is loading ${url}. Call snapshot next to read the new page.`,
    };
  }

  /**
   * Start a Structural Action for a tool call. An action needs a page to
   * compare against, so a session that has observed nothing yet captures
   * once first.
   */
  private async startAction(call: ToolCall): Promise<StructuralActionId> {
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
  private async recordBefore(
    actionId: StructuralActionId,
    page: Capture
  ): Promise<StructuralObservationEntry | undefined> {
    // Set: starting the action captured when nothing had been observed.
    const latest = this.history.latestObservation!;
    const capture = this.checked(page);
    const sinceLatest = StructuralTree.reconcile(
      await latest.tree.resolve(),
      capture.tree
    );
    // A Page Object registered or unregistered without the DOM changing
    // still makes a before: a removed root is marked by it.
    if (
      !sinceLatest.hasAnyChanges() &&
      sameRootMarks(
        this.history.pomRootMarks(latest),
        capture.pomRootMarks,
        sinceLatest
      )
    )
      return undefined;
    const before = this.history.observeBefore(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomRootMarks
    );
    this.rememberElements(capture);
    return before;
  }

  /**
   * Record `page`, the Settled Page after an action, and return that
   * observation, the action's after, where the acting cursor moves. When the
   * capture cannot be recorded, the action is completed as failed with the
   * page as last recorded, and the error travels on.
   */
  private async completeAction(
    actionId: StructuralActionId,
    page: Capture
  ): Promise<StructuralObservationEntry> {
    let capture: PageCapture;
    try {
      capture = this.checked(page);
    } catch (error) {
      await this.failAtLatestObservation(actionId);
      throw error;
    }
    const after = this.history.completeAction(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomRootMarks
    );
    this.rememberElements(capture);
    return after;
  }

  /**
   * Complete an action whose tool call threw, with `capture`, the page after
   * it, or as last recorded without one, and return that observation, the
   * failed action's after. No caller's cursor moves.
   */
  private async failAction(
    actionId: StructuralActionId,
    capture: PageCapture | undefined
  ): Promise<StructuralObservationEntry> {
    if (!capture) return this.failAtLatestObservation(actionId);
    const after = this.history.failAction(
      actionId,
      capture.tree,
      this.history.now(),
      capture.pomRootMarks
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
      this.history.pomRootMarks(latest.observation)
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
      capture.pomRootMarks
    );
    cursor?.move(observation);
    this.rememberElements(capture);
    return capture;
  }

  /** Call in the same step as the observation of these elements is recorded. */
  private rememberElements({
    elementsByRef,
    tree,
  }: Pick<PageCapture, "elementsByRef" | "tree">): void {
    this.latestElements = {
      observation: this.history.latestObservation!,
      elementsByRef,
      tree,
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

  /** Read the recorded tree and its elements together, without another capture. */
  latestCapture(): PageStateCapture | undefined {
    return this.latestElements;
  }

  /** Capture the page for recording, rejecting a capture the identity ledger could not accept. */
  private async captureTree(): Promise<PageCapture> {
    return this.checked(await this.captureDocument());
  }

  /** `page` for recording, rejected when the identity ledger could not accept it. */
  private checked(page: Capture): PageCapture {
    const capture = this.read(page);
    const duplicateRef = capture.tree.findDuplicateRef();
    if (duplicateRef !== null)
      throw new RuntimeStateError(
        `The page capture gave more than one node the Structural Ref ${duplicateRef}.`
      );
    return capture;
  }

  /** `page` for recording, or none when there is none or it cannot be recorded. */
  private checkedOrNone(page: Capture | undefined): PageCapture | undefined {
    try {
      return page && this.checked(page);
    } catch {
      return undefined;
    }
  }

  private pageStateFor(capture: PageCapture): PageState {
    return Object.freeze({
      text: renderPageState(capture).text,
      resolve: async (...refs: AriaRef[]) => this.resolveRefs(refs),
    });
  }

  /**
   * The node a tool's Structural Ref addresses now, against a fresh capture:
   * the one resolver every tool's `ref` goes through.
   */
  async resolveRef(requested: string, label: string): Promise<AymeNode> {
    return resolveRequestedRef(requested, label, (...refs) =>
      this.resolveRefs(refs)
    );
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
