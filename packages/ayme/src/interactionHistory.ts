// Runtime, not publication. This module and the Page State
// Session that owns it import nothing from the publication side: not
// `webMcp.ts`, not tool schema rendering, nothing that touches
// `document.modelContext`. The publication side calls in, never the reverse,
// so moving the runtime into its own package is a file move.

import {
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralActionIdFactory,
  StructuralObservationSession,
  type StructuralTree,
  type AriaRef,
  type MonotonicClock,
  type MonotonicTimeMs,
  type PageId,
  type StructuralActionId,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import type { Cursor } from "./cursors";

/** What core's Structural Action does not carry: the tool call behind it. */
export type ToolCall = {
  readonly tool: string;
  readonly args: unknown;
  /** For a single-element tool, the current ref the action was applied to. */
  readonly targetRef?: AriaRef;
};

/** A tool call as recorded beside its Structural Action. */
export type RecordedAction = ToolCall & {
  /** Set when the tool call threw; the action still completed. */
  readonly failed?: true;
};

let documentCount = 0;

/**
 * A document's interaction history (ADR-0027): a core Structural Observation
 * Session driven from the browser and the tool call behind each Structural
 * Action. Every reading of what changed is core's: this records and names
 * observations, it never diffs them itself. Who received which observation
 * is the cursors' business (`cursors.ts`): the history never learns which
 * Caller started an action.
 *
 * ponytail: everything is kept for the document's life, so memory has no
 * ceiling: it grows by one StructuralTree per observation (two per single-element tool
 * action, one per read or Goal Loop step), 7 to 41 KB each on the example
 * apps. A retention rule replaces this.
 */
export class InteractionHistory {
  readonly pageId: PageId = PageIdSchema.parse(`document_${++documentCount}`);
  readonly observations: StructuralObservationSession;
  private readonly actionIds = new StructuralActionIdFactory();
  private readonly recorded = new Map<StructuralActionId, RecordedAction>();
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

  /** The first observation recorded, of any kind. */
  get firstObservation(): StructuralObservationEntry | undefined {
    return this.first;
  }

  /** Record an already-captured tree as an observation. */
  observe(
    tree: StructuralTree,
    at: MonotonicTimeMs
  ): StructuralObservationEntry {
    return this.record(tree, at);
  }

  /** The observation recorded most recently, of any kind. */
  get latestObservation(): StructuralObservationEntry | undefined {
    return this.latest;
  }

  /**
   * Where `cursor` stands in this history: the observation it last received,
   * or the first observation while it has received none of this document.
   * An observation of another document, which a test's document swap leaves
   * behind, is no position here.
   */
  received(cursor: Cursor): StructuralObservationEntry | undefined {
    const current = cursor.current();
    return current?.pageId === this.pageId ? current : this.first;
  }

  /**
   * Start a Structural Action for a tool call. Its Change Record starts at
   * the observation the acting cursor stands at now, `received(cursor)`, so
   * an action that runs others inside it, as a Custom Tool runs its child
   * Runs, covers what they changed too; whoever reads the record keeps that
   * observation.
   */
  startAction(call: ToolCall): StructuralActionId {
    const actionId = this.actionIds.create();
    this.recorded.set(actionId, { ...call });
    this.observations.recordActionStarted({
      kind: "action-started",
      at: this.now(),
      pageId: this.pageId,
      actionId,
    });
    return actionId;
  }

  /**
   * Complete an action with its Settled Page and return that observation,
   * the action's after, where the acting cursor moves. The Change Record is
   * `readChange` from the observation the cursor stood at when the action
   * started to this one.
   */
  completeAction(
    actionId: StructuralActionId,
    settledPage: StructuralTree,
    at: MonotonicTimeMs
  ): StructuralObservationEntry {
    return this.complete(actionId, settledPage, at);
  }

  /** What changed between two observations of this document: core's reading. */
  readChange(
    from: StructuralObservationEntry,
    to: StructuralObservationEntry
  ): Promise<StructuralTree> {
    return this.observations.readChange(this.pageId, from, to);
  }

  /**
   * Complete an action whose tool call threw, with the page as it is now. The
   * Caller received an error, not a page, so its cursor stays where it was.
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
