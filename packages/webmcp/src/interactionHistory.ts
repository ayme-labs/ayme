// Runtime, not publication (#159, decision D1). This module and the Page State
// Session that owns it import nothing from the publication side: not
// `webMcp.ts`, not tool schema rendering, nothing that touches
// `document.modelContext`. The publication side calls in, never the reverse,
// so moving the runtime into its own package is a file move.

import {
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralActionIdFactory,
  StructuralObservationSession,
  StructuralTree,
  type AriaRef,
  type MonotonicClock,
  type MonotonicTimeMs,
  type PageId,
  type StructuralActionId,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";

/**
 * Who receives page states and acts: the calling agent (through WebMCP Tools
 * or the `ayme` API) or the Goal Loop's System One model.
 *
 * ponytail: `goalLoop` is a reader id of its own until the Goal Loop becomes
 * a plain consumer of the history (D7, #168).
 */
export type Caller = "agent" | "goalLoop";

/** What core's Structural Action does not carry: the tool call behind it. */
export type ToolCall = {
  readonly tool: string;
  readonly args: unknown;
  /** For a Ref Tool, the current ref the action was applied to. */
  readonly targetRef?: AriaRef;
};

/** A tool call as recorded beside its Structural Action. */
export type RecordedAction = ToolCall & {
  readonly caller: Caller;
  /** Set when the tool call threw; the action still completed. */
  readonly failed?: true;
};

let documentCount = 0;

/**
 * A document's interaction history (ADR-0027): a core Structural Observation
 * Session driven from the browser, the tool call behind each Structural
 * Action, and, per caller, the observation that caller last received.
 *
 * ponytail: everything is kept for the document's life, so memory has no
 * ceiling: it grows by one StructuralTree per observation (two per Ref Tool
 * action, one per read or Goal Loop step), measured at 7 to 41 KB each on the
 * example apps. A retention rule replaces this.
 */
export class InteractionHistory {
  readonly pageId: PageId = PageIdSchema.parse(`document_${++documentCount}`);
  readonly observations: StructuralObservationSession;
  private readonly actionIds = new StructuralActionIdFactory();
  private readonly recorded = new Map<StructuralActionId, RecordedAction>();
  /**
   * ponytail: two remembered positions, the observation each caller last
   * received; they become reader points with an explicit `since` (D7, #168).
   */
  private readonly cursors = new Map<Caller, StructuralObservationEntry>();
  private first: StructuralObservationEntry | undefined;
  private latest: StructuralObservationEntry | undefined;

  constructor(
    currentDocument: Document,
    private readonly clock: MonotonicClock
  ) {
    this.observations = new StructuralObservationSession({ clock });
    this.observations.recordNavigation({
      pageId: this.pageId,
      url: currentDocument.URL,
      cause: "initial",
    });
    const view = currentDocument.defaultView;
    if (view)
      watchSameDocumentNavigations(view, () =>
        this.observations.recordNavigation({
          pageId: this.pageId,
          url: currentDocument.URL,
          cause: "navigate",
        })
      );
  }

  now(): MonotonicTimeMs {
    return MonotonicTimeMsSchema.parse(this.clock.now());
  }

  /** Whether anything was observed yet; the first observation stands in for an unset cursor. */
  get hasObservation(): boolean {
    return this.first !== undefined;
  }

  /** Record an already-captured tree as an observation; `receivedBy` moves that caller's cursor. */
  observe(
    tree: StructuralTree,
    at: MonotonicTimeMs,
    receivedBy?: Caller
  ): StructuralObservationEntry {
    const entry = this.record(tree, at);
    if (receivedBy) this.cursors.set(receivedBy, entry);
    return entry;
  }

  /** The observation recorded most recently, of any kind. */
  get latestObservation(): StructuralObservationEntry | undefined {
    return this.latest;
  }

  /** The observation `caller` last received; the first observation while it has received none. */
  cursor(caller: Caller): StructuralObservationEntry | undefined {
    return this.cursors.get(caller) ?? this.first;
  }

  /** Start a Structural Action for `caller`'s tool call. */
  startAction(caller: Caller, call: ToolCall): StructuralActionId {
    const actionId = this.actionIds.create();
    this.recorded.set(actionId, { ...call, caller });
    this.observations.recordActionStarted({
      kind: "action-started",
      at: this.now(),
      pageId: this.pageId,
      actionId,
    });
    return actionId;
  }

  /**
   * Complete an action with its Settled Page and return its Change Record
   * tree: the observation the acting caller last received reconciled against
   * the Settled Page, which then becomes that caller's cursor.
   *
   * The Change Record is read from these two observations rather than from
   * core's derived `actionChange`: that starts at the latest observation
   * before the action (a ref-resolution capture, not the caller's), an
   * action that changes the route completes in the next Visit, where core
   * keeps its before state as its after state, and each query replays every
   * earlier action of the Visit, quadratic per Visit.
   *
   * ponytail: the reconcile here stands in for core's two-point reading
   * (D8, #169).
   */
  async completeAction(
    actionId: StructuralActionId,
    settledPage: StructuralTree,
    at: MonotonicTimeMs
  ): Promise<StructuralTree> {
    const action = this.recordedAction(actionId);
    const before = this.cursor(action.caller);
    const after = this.complete(actionId, settledPage, at);
    this.cursors.set(action.caller, after);
    return StructuralTree.reconcile(
      await (before ?? after).tree.resolve(),
      settledPage
    );
  }

  /**
   * Complete an action whose tool call threw, with the page as it is now. The
   * caller received an error, not a page, so its cursor stays where it was.
   */
  failAction(
    actionId: StructuralActionId,
    page: StructuralTree,
    at: MonotonicTimeMs
  ): void {
    this.recorded.set(actionId, {
      ...this.recordedAction(actionId),
      failed: true,
    });
    this.complete(actionId, page, at);
  }

  /**
   * The Goal Loop hands control back: the calling agent has now received the
   * page the model last received, as it did when both shared one baseline.
   */
  handOver(): void {
    const received = this.cursors.get("goalLoop");
    if (!received) return;
    this.cursors.set("agent", received);
    this.cursors.delete("goalLoop");
  }

  /** The tool calls behind the recorded Structural Actions, in start order. */
  actions(): ReadonlyMap<StructuralActionId, RecordedAction> {
    return this.recorded;
  }

  private recordedAction(actionId: StructuralActionId): RecordedAction {
    const action = this.recorded.get(actionId);
    if (!action) throw new Error(`No recorded action ${actionId}.`);
    return action;
  }

  /** Record the action's after observation and its completion. */
  private complete(
    actionId: StructuralActionId,
    page: StructuralTree,
    at: MonotonicTimeMs
  ): StructuralObservationEntry {
    const after = this.record(page, at, actionId);
    this.observations.recordActionCompleted({
      kind: "action-completed",
      at: this.now(),
      pageId: this.pageId,
      actionId,
    });
    return after;
  }

  private record(
    tree: StructuralTree,
    at: MonotonicTimeMs,
    capturedForActionId?: StructuralActionId
  ): StructuralObservationEntry {
    const entry = this.observations.recordObservation({
      kind: "observation",
      at,
      pageId: this.pageId,
      tree: { pageId: this.pageId, capturedAt: at, resolve: async () => tree },
      ...(capturedForActionId ? { capturedForActionId } : {}),
    });
    this.first ??= entry;
    this.latest = entry;
    return entry;
  }
}

/**
 * Call `onNavigate` after every same-document navigation: through the
 * Navigation API where the browser has one, otherwise through `popstate`,
 * `hashchange` (a fragment navigation such as assigning `location.hash`) and
 * wrapped `history.pushState` / `replaceState`, which fire no event. A URL
 * reported twice is recorded once.
 */
function watchSameDocumentNavigations(view: Window, onNavigate: () => void) {
  const navigation = (
    view as Window & {
      navigation?: Pick<EventTarget, "addEventListener">;
    }
  ).navigation;
  if (navigation) {
    navigation.addEventListener("currententrychange", onNavigate);
    return;
  }
  view.addEventListener("popstate", onNavigate);
  view.addEventListener("hashchange", onNavigate);
  const history = view.history;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args) {
      original.apply(this, args);
      onNavigate();
    };
  }
}
