import {
  parseStructuralRef,
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
  type DocumentToken,
  type Predicate,
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
import type { PomRootIds } from "../domain/pomRootMarks";
import { resolveRequestedRef } from "./refResolution";

/**
 * The Page State Session's port: a capture of the page as it is now, as
 * plain data from the document's in-page module, whose refs, synthetic ones
 * included, are the document's own, whoever captures.
 */
export type CapturePage = (accepts?: readonly Predicate[]) => Promise<Capture>;

/** What a reader of a capture asks of it besides its tree. */
export type CaptureAsk = {
  /** The predicates whose accepted refs the capture carries. */
  accepts?: readonly Predicate[];
};

/**
 * The Page State Session's port for its actions: `begin` captures the page
 * right before an action, and its `perform` runs the action, waits for a
 * Settled Page, bounded by a deadline, and captures it, or answers at once
 * when the action starts a full page load.
 */
export type ActionPage = {
  begin(): Promise<PageAction>;
};

/** The id of each Page Object Root `rootRefs` name, in the order given. */
export type RootIds = (
  rootRefs: readonly string[]
) => Promise<(string | undefined)[]>;

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
   * The tree of the latest recorded observation. The identity ledger stands
   * at that observation when it is read, so its current refs are checked
   * against it; only this one is kept, never one per observation.
   */
  private latestRecorded:
    | {
        observation: StructuralObservationEntry;
        tree: StructuralTree;
        renamed?: ReadonlyMap<string, string>;
      }
    | undefined;
  private readonly recordedListeners = new Set<() => void>();
  // The synthetic refs this session's trees mint for themselves.
  private refFactory = treeRefAllocator();
  private current: InteractionHistory;
  // The document the session's captures are of, once it has taken one.
  private document: DocumentToken | undefined;

  /**
   * `history`: every capture is an observation in it; the observation a
   * cursor stands at is the "before" of its next Change Record, and its
   * identity ledger keeps ref continuity. Captures Ayme makes for itself
   * move no cursor.
   *
   * `restart`: a host whose Page outlives its documents, which a full load
   * replaces, hands the history a new document starts with, for the URL it
   * loaded. Each document has its own history, identity ledger and refs, as
   * the browser runtime's has by starting over at a full load. Without it,
   * the session keeps one document's.
   *
   * `rootIds`: what the page state text a reader receives prints on each
   * Page Object Root beside its marks, by the root's Structural Ref, in the
   * order asked; undefined for a root that has none. Without it, the text
   * prints none.
   */
  constructor(
    history: InteractionHistory,
    private readonly captureDocument: CapturePage,
    private readonly actionPage: ActionPage,
    private readonly restart?: (url: string) => InteractionHistory,
    private readonly rootIds?: RootIds
  ) {
    this.current = history;
  }

  /** The history of the document the session reads now. */
  get history(): InteractionHistory {
    return this.current;
  }

  /**
   * Takes note of the document `capture` is of: the session's first, or one
   * of the same document, goes on; one of another document, which a full
   * load replaced it with, starts over there, so no ref, observation or
   * cursor of the old document is read against the new one. Whether it
   * started over.
   */
  private enter(capture: Capture): boolean {
    const known = this.document;
    this.document = capture.document;
    if (known === undefined || known === capture.document || !this.restart)
      return false;
    this.current = this.restart(capture.url);
    this.latestRecorded = undefined;
    this.refFactory = treeRefAllocator();
    return true;
  }

  /** A capture of the page as the session reads it: its tree and marks. */
  private async capturePage({
    accepts,
  }: CaptureAsk = {}): Promise<PageCapture> {
    const capture = await this.captureDocument(accepts);
    this.enter(capture);
    return this.read(capture);
  }

  /** `capture` as the session reads it: its tree and marks. */
  private read(capture: Capture): PageCapture {
    const { tree, pomRootMarks } = structureCapture(capture, this.refFactory);
    return {
      tree,
      pomRootMarks,
      ...(capture.accepted ? { accepted: acceptedSets(capture.accepted) } : {}),
      ...(capture.renamed
        ? { renamed: new Map(Object.entries(capture.renamed)) }
        : {}),
    };
  }

  async getPageState(cursor?: Cursor): Promise<PageState> {
    const capture = await this.capture(cursor);
    return this.pageStateFor(capture, await this.rootIdsOf(capture));
  }

  /** The id of each Page Object Root of `capture` that has one, by ref. */
  private async rootIdsOf(capture: PageCapture): Promise<PomRootIds> {
    // In the order the tree shows them, which is the order a root new to
    // the page gets its id in.
    const roots = capture.tree
      .getAllRefs()
      .filter((ref) => capture.pomRootMarks.has(ref));
    if (!this.rootIds || roots.length === 0) return new Map();
    const ids = await this.rootIds(roots);
    return new Map(
      roots.flatMap((root, index) => {
        const id = ids[index];
        return id === undefined ? [] : [[root, id] as const];
      })
    );
  }

  async getPageStateCapture(
    cursor?: Cursor,
    ask?: CaptureAsk
  ): Promise<PageCapture> {
    return this.capture(cursor, ask);
  }

  /**
   * Capture the page without recording it: no observation, no cursor, no
   * tree kept. What callers see next is the same as if it never ran. Its
   * refs, `e` and `s_` alike, are the ones the page's next recorded capture
   * gives the same elements, so a tool run on a ref the look printed acts on
   * the element it showed.
   */
  async look(ask?: CaptureAsk): Promise<PageStateLook> {
    const capture = await this.capturePage(ask);
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
    let actionId = await this.startAction(call);
    let history = this.history;
    // The start of the Change Record: where the cursor stands as the action
    // starts; child Runs inside the action move the cursor on.
    let received = history.received(cursor);
    // The page as last observed: the action's before unless the before
    // capture finds the page moved on since.
    let before = history.latestObservation;
    let outcome: ActionOutcome<unknown>;
    try {
      const action = await this.actionPage.begin();
      // A full load since the session last read the page: the action runs in
      // the new document, whose history it starts in.
      if (this.enter(action.before)) {
        actionId = await this.startAction(call);
        history = this.history;
        received = history.received(cursor);
        before = history.latestObservation;
      }
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
    this.rememberTree(capture);
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
    this.rememberTree(capture);
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
    this.rememberTree(capture);
    return after;
  }

  /** Complete a failed action without a capture, when capturing is what failed. */
  private async failAtLatestObservation(
    actionId: StructuralActionId
  ): Promise<StructuralObservationEntry> {
    // Set since the action started: every recorded observation remembers its
    // tree. Read before awaiting, so the observation and its tree match.
    const latest = this.latestRecorded!;
    const tree = await latest.observation.tree.resolve();
    const after = this.history.failAction(
      actionId,
      tree,
      this.history.now(),
      this.history.pomRootMarks(latest.observation)
    );
    this.rememberTree(latest);
    return after;
  }

  /** Capture and record an observation; `cursor`, the reader receiving it, moves there. */
  private async capture(
    cursor?: Cursor,
    ask?: CaptureAsk
  ): Promise<PageCapture> {
    const taken = await this.captureDocument(ask?.accepts);
    this.enter(taken);
    const capture = this.checked(taken);
    // Stamped once the capture is taken, so it cannot share its time with an
    // action started right after it.
    const observation = this.history.observe(
      capture.tree,
      this.history.now(),
      capture.pomRootMarks
    );
    cursor?.move(observation);
    this.rememberTree(capture);
    return capture;
  }

  /** Call in the same step as the observation of this tree is recorded. */
  private rememberTree({
    tree,
    renamed,
  }: Pick<PageCapture, "tree" | "renamed">): void {
    this.latestRecorded = {
      observation: this.history.latestObservation!,
      tree,
      ...(renamed ? { renamed } : {}),
    };
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
   * The ref the latest recorded page state gave what the in-page ref `ref`
   * names: `ref` itself while that page state holds it, as every host reads
   * the refs of one document, or the mark the capture gave the element a
   * probe named by `ref` first.
   */
  latestRefOfNamed(ref: string): AriaRef | undefined {
    const latest = this.latestRecorded;
    if (!latest) return undefined;
    for (const candidate of [ref, latest.renamed?.get(ref)]) {
      const parsed =
        candidate === undefined ? undefined : parseStructuralRef(candidate);
      if (parsed !== undefined && latest.tree.hasNode(parsed)) return parsed;
    }
    return undefined;
  }

  /** Read the recorded tree without another capture. */
  latestCapture(): Pick<PageStateCapture, "tree"> | undefined {
    return this.latestRecorded;
  }

  /** Capture the page for recording, rejecting a capture the identity ledger could not accept. */
  private async captureTree({
    accepts,
  }: CaptureAsk = {}): Promise<PageCapture> {
    return this.checked(await this.captureDocument(accepts));
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

  private pageStateFor(capture: PageCapture, rootIds: PomRootIds): PageState {
    return Object.freeze({
      text: renderPageState(capture, rootIds).text,
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
    // capture that interleaved after this one; refs and tree are taken from
    // that same observation.
    await this.capture();
    return this.history.observations.readIdentityLedger(
      this.history.pageId,
      (ledger, through) => {
        const latest = this.latestRecorded;
        if (!latest || latest.observation !== through)
          throw new RuntimeStateError(
            "The identity ledger stands at an observation without a recorded tree."
          );
        return refs.map((requestedRef) => resolveOne(ledger, requestedRef));
      }
    );
  }
}

/** The refs each predicate, or named filter, keeps, as sets. */
function acceptedSets(
  accepted: NonNullable<Capture["accepted"]>
): NonNullable<PageCapture["accepted"]> {
  return Object.fromEntries(
    Object.entries(accepted).map(([predicate, refs]) => [
      predicate,
      new Set(refs),
    ])
  );
}

function resolveOne(
  ledger: StructuralIdentityLedger,
  requestedRef: AriaRef
): RefResolution {
  const identity = ledger.resolve(requestedRef);
  if (identity.status === "unresolved") return identity;
  return {
    status: "resolved",
    requestedRef,
    node: { ref: identity.currentRef },
  };
}
