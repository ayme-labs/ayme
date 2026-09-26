import { StructuralTree } from "../tree/StructuralTree";
import type { MonotonicTimeMs } from "../capture/MonotonicTimeMs";
import type { StructuralTreeEvidence } from "../capture/StructuralTreeEvidence";
import type { PageId } from "../capture/PageId";
import type { StructuralActionId } from "./StructuralAction";
import type { VisitId, VisitStartedCause } from "./Visit";

export type StructuralTreeEvidenceResolver = (
  evidence: StructuralTreeEvidence
) => Promise<StructuralTree>;

const resolveStructuralTreeEvidence: StructuralTreeEvidenceResolver = async (
  evidence
) => await evidence.resolve();

export type StructuralNavigationEntry = {
  readonly kind: "navigation";
  readonly at: MonotonicTimeMs;
  readonly pageId: PageId;
  readonly fromUrl: string | null;
  readonly toUrl: string;
  readonly cause: VisitStartedCause;
  readonly startedVisitId?: VisitId;
};

export type StructuralVisitOpeningNavigationEntry =
  StructuralNavigationEntry & {
    readonly startedVisitId: VisitId;
  };

export type StructuralVisitSnapshot = {
  id: VisitId;
  pageId: PageId;
  urls: string[];
};

function nextVisitBoundaryIndex(
  entries: ReadonlyArray<StructuralTimelineEntry>,
  fromIndex: number
): number {
  const pageId = entries[fromIndex]?.pageId;
  for (let index = fromIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      entry.kind === "navigation" &&
      entry.startedVisitId !== undefined &&
      entry.pageId === pageId
    )
      return index;
  }
  return entries.length;
}

function collectVisitUrls(
  entries: ReadonlyArray<StructuralTimelineEntry>,
  openingIndex: number
): string[] {
  const opening = entries[openingIndex];
  if (opening?.kind !== "navigation")
    throw new Error("Expected a visit-opening navigation entry.");
  const urls = [opening.toUrl];
  const endIndex = nextVisitBoundaryIndex(entries, openingIndex);
  for (let index = openingIndex + 1; index < endIndex; index += 1) {
    const entry = entries[index]!;
    if (
      entry.kind !== "navigation" ||
      entry.startedVisitId !== undefined ||
      entry.pageId !== opening.pageId
    )
      continue;
    if (!urls.includes(entry.toUrl)) urls.push(entry.toUrl);
  }
  return urls;
}

function deriveVisitsFromEntries(
  entries: ReadonlyArray<StructuralTimelineEntry>
): StructuralVisitSnapshot[] {
  const visits: StructuralVisitSnapshot[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.kind !== "navigation" || entry.startedVisitId === undefined)
      continue;
    visits.push({
      id: entry.startedVisitId,
      pageId: entry.pageId,
      urls: collectVisitUrls(entries, index),
    });
  }
  return visits;
}

export function normalizeNavigationUrl(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

export function isHashOnlyNavigation(fromUrl: string, toUrl: string): boolean {
  try {
    const previous = new URL(fromUrl);
    const next = new URL(toUrl);
    return (
      previous.origin === next.origin &&
      previous.pathname === next.pathname &&
      previous.search === next.search &&
      previous.hash !== next.hash
    );
  } catch {
    return false;
  }
}

export function startsNewVisit(
  previousUrl: string | null,
  nextUrl: string
): boolean {
  if (previousUrl === null) return true;
  if (normalizeNavigationUrl(previousUrl) === normalizeNavigationUrl(nextUrl))
    return false;
  if (isHashOnlyNavigation(previousUrl, nextUrl)) return false;
  return true;
}

export type StructuralObservationEntry = {
  readonly kind: "observation";
  readonly at: MonotonicTimeMs;
  readonly pageId: PageId;
  /**
   * Lazy handle to the observation's structural tree. Selecting boundaries reads only metadata
   * (`at`, `capturedForActionId`); the concrete tree is resolved (replayed/parsed) only for the
   * observations actually chosen as evidence.
   */
  readonly tree: StructuralTreeEvidence;
  /**
   * Set when this observation is the explicit post-action capture for a specific action. It is the
   * authoritative after-state for that action: polling observations (which leave this absent) cannot
   * override it merely by having an earlier timestamp.
   */
  readonly capturedForActionId?: StructuralActionId;
};

export type StructuralActionStartedEntry = {
  readonly kind: "action-started";
  readonly at: MonotonicTimeMs;
  readonly pageId: PageId;
  readonly actionId: StructuralActionId;
};

export type StructuralActionCompletedEntry = {
  readonly kind: "action-completed";
  readonly at: MonotonicTimeMs;
  readonly pageId: PageId;
  readonly actionId: StructuralActionId;
};

export type StructuralTimelineEntry =
  | StructuralNavigationEntry
  | StructuralObservationEntry
  | StructuralActionStartedEntry
  | StructuralActionCompletedEntry;

export type StructuralVisitTimelineEvidence = {
  readonly visitId: VisitId;
  readonly pageId: PageId;
  readonly url: string;
  readonly cause: VisitStartedCause;
  readonly structuralTree: StructuralTree;
};

export type StructuralResolvedChange = {
  readonly timestamp: MonotonicTimeMs;
  readonly changeTree: StructuralTree;
  readonly structuralTree: StructuralTree;
  readonly sourceTreeEvidence: StructuralTreeEvidence;
  /** The reconciled current tree at the before-state, used to anchor removed or navigating action targets. */
  readonly beforeStructuralTree?: StructuralTree;
  /** Present when this action crossed into a new visit. */
  readonly navigation?: { toUrl: string };
};

export type StructuralActionTimelineEvidence = {
  readonly visitId: VisitId;
  readonly unassignedChanges: StructuralResolvedChange[];
  readonly actionChange: StructuralResolvedChange;
};

type WindowAction = {
  readonly actionId: StructuralActionId;
  readonly startedAt: MonotonicTimeMs;
  readonly endedAt: MonotonicTimeMs;
  /** True when the action completed only after the owning visit's window closed (a navigating action). */
  readonly crossesVisitBoundary: boolean;
};

/**
 * A session-wide, time-ordered structural event store. It records visit starts, structural
 * observations, and action start/completion signals as entries ordered by their monotonic `at`
 * timestamp (capture order is not event-time order: background polling and delayed action completion
 * can interleave, so entries are inserted in order rather than appended).
 *
 * Evidence resolution is pure and idempotent. Queries scope their observations to the owning visit's
 * window (from its visit-opening navigation entry up to the next one for the same page), so a navigating
 * action whose completion lands in a later visit is still attributed to its source visit and resolved
 * against that window's observations rather than leaking into the destination visit's tree.
 */
export class StructuralTimeline {
  private readonly _entries: StructuralTimelineEntry[] = [];

  visits(): ReadonlyArray<StructuralVisitSnapshot> {
    return deriveVisitsFromEntries(this._entries);
  }

  currentVisitIdForPage(pageId: PageId): VisitId | null {
    let current: VisitId | null = null;
    for (const entry of this._entries) {
      if (
        entry.kind !== "navigation" ||
        entry.startedVisitId === undefined ||
        entry.pageId !== pageId
      )
        continue;
      current = entry.startedVisitId;
    }
    return current;
  }

  latestNavigationUrlForPage(pageId: PageId): string | null {
    let latest: string | null = null;
    for (const entry of this._entries) {
      if (entry.kind !== "navigation" || entry.pageId !== pageId) continue;
      latest = entry.toUrl;
    }
    return latest;
  }

  recordNavigation<T extends StructuralNavigationEntry>(entry: T): T {
    this._insert(entry);
    return entry;
  }

  recordObservation(
    entry: StructuralObservationEntry
  ): StructuralObservationEntry {
    this._insert(entry);
    return entry;
  }

  recordActionStarted(
    entry: StructuralActionStartedEntry
  ): StructuralActionStartedEntry {
    this._insert(entry);
    return entry;
  }

  recordActionCompleted(
    entry: StructuralActionCompletedEntry
  ): StructuralActionCompletedEntry {
    this._insert(entry);
    return entry;
  }

  /**
   * Visit bootstrap evidence: the visit's metadata plus the first structural observation recorded
   * within the visit's window. Windows are scoped by entry position (from the visit-opening navigation
   * entry up to the next one for the same page) rather than by timestamp, so visits that share a timestamp
   * do not borrow each other's observations.
   */
  async getVisitEvidence(
    visitId: VisitId,
    resolveTree: StructuralTreeEvidenceResolver = resolveStructuralTreeEvidence
  ): Promise<StructuralVisitTimelineEvidence> {
    const startIndex = this._entries.findIndex(
      (entry) => entry.kind === "navigation" && entry.startedVisitId === visitId
    );
    if (startIndex < 0)
      throw new Error(`No recorded visit with id ${String(visitId)}.`);
    const start = this._entries[startIndex];
    if (start?.kind !== "navigation")
      throw new Error(`No recorded visit with id ${String(visitId)}.`);
    const visitIdResolved = start.startedVisitId;
    if (!visitIdResolved)
      throw new Error(`No recorded visit with id ${String(visitId)}.`);

    const windowEntries = this._entries.slice(
      startIndex + 1,
      this._nextVisitBoundaryIndex(startIndex)
    );
    const observations = windowEntries.filter(
      (entry): entry is StructuralObservationEntry =>
        entry.kind === "observation" && entry.pageId === start.pageId
    );
    if (observations.length === 0)
      throw new Error(
        `No structural observation recorded for visit ${String(visitId)}.`
      );

    // Resolution is best-effort per observation: an early visit-start capture can sample an empty page
    // whose live ARIA read returned no content. Return the first observation that resolves to a concrete
    // tree so a slow/empty bootstrap never drops the visit's structural evidence.
    for (const observation of observations) {
      const tree = await this._tryResolve(observation, resolveTree);
      if (!tree) continue;
      return {
        visitId: visitIdResolved,
        pageId: start.pageId,
        url: start.toUrl,
        cause: start.cause,
        structuralTree: tree,
      };
    }
    throw new Error(
      `No resolvable structural observation recorded for visit ${String(visitId)}.`
    );
  }

  /** Best-effort resolve of an observation's lazy tree handle; `null` when its snapshot is unparseable. */
  private async _tryResolve(
    observation: StructuralObservationEntry,
    resolveTree: StructuralTreeEvidenceResolver
  ): Promise<StructuralTree | null> {
    try {
      return await resolveTree(observation.tree);
    } catch {
      return null;
    }
  }

  /**
   * Resolves structural evidence for a recorded action by id. Pure and idempotent: it replays the
   * owning visit's ordered observations and actions without mutating stored entries.
   *
   * The owning visit is the latest visit-opening navigation entry positioned before the action-started
   * entry on the same page, and the window runs from that entry up to the page's next visit-opening
   * navigation. Scoping by entry position (not timestamp) keeps visits that share a timestamp from
   * borrowing each other's observations.
   * Boundaries are selected only from observations inside the owning visit's window:
   * - before: latest observation with `at < startedAt`
   * - after: the action's explicit post-action capture (the observation tagged with this action id),
   *   which is authoritative even when earlier polls exist. If that capture only completed after the
   *   next action started it may already reflect the next action, so it is excluded in favour of the
   *   latest poll strictly before the next action start; with no such poll the action keeps its
   *   before-state (an unchanged diff). A crossing/navigation action (or a non-crossing action whose
   *   window has since closed without an explicit capture) falls back to the source window's last
   *   observation. A non-crossing action in an open window with no explicit capture is invalid.
   * - baseline: previous action's after-boundary (or the visit's first observation)
   * - unassignedChanges: a meaningful diff from baseline to before; unchanged polling observations are omitted
   * - actionChange: the diff from before to after
   *
   * Observations inside `[startedAt, endedAt]` are never selected as boundaries. Tree-id continuity is
   * preserved by projecting reconciled current trees forward through prior action boundaries.
   */
  async getActionEvidence(
    actionId: StructuralActionId,
    resolveEvidence: StructuralTreeEvidenceResolver = resolveStructuralTreeEvidence
  ): Promise<StructuralActionTimelineEvidence> {
    const startedIndex = this._entries.findIndex(
      (entry) => entry.kind === "action-started" && entry.actionId === actionId
    );
    const completed = this._entries.find(
      (entry): entry is StructuralActionCompletedEntry =>
        entry.kind === "action-completed" && entry.actionId === actionId
    );
    if (startedIndex < 0 || !completed)
      throw new Error(`No recorded action with id ${String(actionId)}.`);

    const owningVisitIndex = this._latestVisitBoundaryIndexBefore(startedIndex);
    if (owningVisitIndex < 0)
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );
    const owningVisit = this._entries[owningVisitIndex];
    if (owningVisit?.kind !== "navigation") {
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );
    }
    const owningVisitId = owningVisit.startedVisitId;
    if (!owningVisitId)
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );

    const nextVisitBoundaryIndex =
      this._nextVisitBoundaryIndex(owningVisitIndex);
    const windowEntries = this._entries
      .slice(owningVisitIndex + 1, nextVisitBoundaryIndex)
      .filter((entry) => entry.pageId === owningVisit.pageId);
    const observations = windowEntries.filter(
      (entry): entry is StructuralObservationEntry =>
        entry.kind === "observation"
    );
    const actions = this._windowActions(windowEntries, nextVisitBoundaryIndex);
    // Every action start in the window, including actions that have started but not yet completed. The
    // contamination guard keys off the next action's *start*, which is already on the timeline before
    // that action completes (the case where an earlier action's slow capture lands too late).
    const actionStartTimes = windowEntries
      .filter(
        (entry): entry is StructuralActionStartedEntry =>
          entry.kind === "action-started"
      )
      .map((entry) => entry.at)
      .sort((a, b) => a - b);

    const queriedIndex = actions.findIndex(
      (action) => action.actionId === actionId
    );
    if (queriedIndex < 0)
      throw new Error(`No recorded action with id ${String(actionId)}.`);
    if (observations.length === 0) {
      throw new Error(
        "Unable to resolve structural action evidence from observations."
      );
    }

    // Resolve each selected observation's lazy tree at most once. Only the handful of observations
    // chosen as boundaries while threading up to the queried action are resolved; unselected polling
    // observations keep their cheap handles. Successes and failures are both memoized so an unresolvable snapshot
    // (e.g. an empty page
    // whose live ARIA had no content) is never resolved repeatedly.
    const treeCache = new Map<StructuralObservationEntry, StructuralTree>();
    const failedResolves = new Set<StructuralObservationEntry>();
    const tryResolveTree = async (
      observation: StructuralObservationEntry
    ): Promise<StructuralTree | null> => {
      const cached = treeCache.get(observation);
      if (cached) return cached;
      if (failedResolves.has(observation)) return null;
      try {
        const tree = await resolveEvidence(observation.tree);
        treeCache.set(observation, tree);
        return tree;
      } catch {
        failedResolves.add(observation);
        return null;
      }
    };
    // Strict resolve for committed evidence (an action's authoritative after-state): a failure here
    // must reject rather than degrade silently.
    const resolveTree = async (
      observation: StructuralObservationEntry
    ): Promise<StructuralTree> => {
      const cached = treeCache.get(observation);
      if (cached) return cached;
      const tree = await resolveEvidence(observation.tree);
      treeCache.set(observation, tree);
      return tree;
    };

    // The canonical baseline is the visit's first observation (visit-start). When it resolves, keep it
    // so spontaneous changes between visit-start and the first action still surface as unassigned
    // changes. When it cannot resolve (e.g. an empty SPA shell), fall back to the LATEST resolvable
    // observation strictly before the first action, walking backward from that before-boundary: this
    // treats pre-action hydration/render as unknown initial state rather than a spontaneous change, and
    // never crosses into the action window so a post-action snapshot can never become the baseline
    // (bleed-safe). The backward fallback also avoids replaying earlier empty shells once a later
    // resolvable snapshot is found.
    const firstAction = actions[0]!;
    const firstBeforeBound =
      this._latestObservationIndexBefore(observations, firstAction.startedAt) ??
      0;
    let baselineIndex = 0;
    let baselineTree = await tryResolveTree(observations[0]!);
    if (!baselineTree) {
      baselineIndex = firstBeforeBound;
      while (baselineIndex >= 0) {
        const candidate = await tryResolveTree(observations[baselineIndex]!);
        if (candidate) {
          baselineTree = candidate;
          break;
        }
        baselineIndex -= 1;
      }
    }
    if (!baselineTree) {
      throw new Error(
        "Unable to resolve a structural baseline observation for the action window."
      );
    }
    let resolved: StructuralActionTimelineEvidence | null = null;

    for (let index = 0; index <= queriedIndex; index += 1) {
      const action = actions[index]!;
      // No observation strictly before the action means the visit's baseline observation (the first in
      // the window) is the before-state. This keeps the baseline available even when an action shares
      // the visit-start timestamp, where a strict `<` lookup would otherwise find nothing.
      let beforeIndex =
        this._latestObservationIndexBefore(observations, action.startedAt) ??
        baselineIndex;
      // Skip unresolvable before-candidates, walking back toward (never past) the running baseline so a
      // poll whose snapshot is unparseable falls back to the nearest resolvable earlier observation.
      while (
        beforeIndex > baselineIndex &&
        !(await tryResolveTree(observations[beforeIndex]!))
      ) {
        beforeIndex -= 1;
      }
      if (beforeIndex < baselineIndex) beforeIndex = baselineIndex;
      const nextActionStart = actionStartTimes.find(
        (startedAt) => startedAt > action.startedAt
      );
      const afterIndex = this._selectAfterIndex(observations, action, {
        beforeIndex,
        nextActionStart,
        visitWindowClosed: nextVisitBoundaryIndex < this._entries.length,
      });

      let unassignedChanges: StructuralResolvedChange[] = [];
      let beforeTree: StructuralTree;
      const beforeResolved =
        beforeIndex !== baselineIndex
          ? await tryResolveTree(observations[beforeIndex]!)
          : null;
      if (beforeResolved) {
        const before = observations[beforeIndex]!;
        const changeTree = StructuralTree.reconcile(
          baselineTree,
          beforeResolved
        );
        beforeTree = changeTree.toCurrentTree();
        if (changeTree.hasAnyChanges()) {
          unassignedChanges = [
            {
              timestamp: before.at,
              beforeStructuralTree: baselineTree,
              changeTree,
              structuralTree: beforeTree,
              sourceTreeEvidence: before.tree,
            },
          ];
        }
      } else {
        beforeTree = baselineTree;
      }

      const after = observations[afterIndex]!;
      const actionChangeTree = StructuralTree.reconcile(
        beforeTree,
        await resolveTree(after)
      );

      if (index === queriedIndex) {
        resolved = {
          visitId: owningVisitId,
          unassignedChanges,
          actionChange: {
            timestamp: after.at,
            changeTree: actionChangeTree,
            structuralTree: actionChangeTree.toCurrentTree(),
            sourceTreeEvidence: after.tree,
            beforeStructuralTree: beforeTree,
          },
        };
      }

      baselineIndex = afterIndex;
      baselineTree = actionChangeTree.toCurrentTree();
    }

    if (!resolved)
      throw new Error(
        "Unable to resolve structural action evidence from observations."
      );
    return resolved;
  }

  /**
   * Whether the action's `action-completed` entry is positioned at or after the next visit-opening
   * navigation on the same page that follows its owning visit — i.e. the action navigated and only
   * settled inside a later visit.
   * The evidence service uses this to skip a destination-page capture that would otherwise sample the
   * wrong page and contaminate the source action's evidence.
   */
  actionCrossedVisitBoundary(actionId: StructuralActionId): boolean {
    const startedIndex = this._entries.findIndex(
      (entry) => entry.kind === "action-started" && entry.actionId === actionId
    );
    const completedIndex = this._entries.findIndex(
      (entry) =>
        entry.kind === "action-completed" && entry.actionId === actionId
    );
    if (startedIndex < 0 || completedIndex < 0)
      throw new Error(`No recorded action with id ${String(actionId)}.`);

    const owningVisitIndex = this._latestVisitBoundaryIndexBefore(startedIndex);
    if (owningVisitIndex < 0)
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );

    return completedIndex >= this._nextVisitBoundaryIndex(owningVisitIndex);
  }

  actionOwningVisitId(actionId: StructuralActionId): VisitId {
    const startedIndex = this._entries.findIndex(
      (entry) => entry.kind === "action-started" && entry.actionId === actionId
    );
    if (startedIndex < 0)
      throw new Error(`No recorded action with id ${String(actionId)}.`);

    const owningVisitIndex = this._latestVisitBoundaryIndexBefore(startedIndex);
    const owningVisit = this._entries[owningVisitIndex];
    if (owningVisit?.kind !== "navigation" || !owningVisit.startedVisitId)
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );
    return owningVisit.startedVisitId;
  }

  /**
   * Returns destination navigation info when the action crossed a visit-opening navigation boundary,
   * or `null` for non-navigation actions. Based on timeline entry ordering, not runtime heuristics.
   */
  getNavigationSignalForAction(
    actionId: StructuralActionId
  ): { toUrl: string } | null {
    if (!this.actionCrossedVisitBoundary(actionId)) return null;

    const startedIndex = this._entries.findIndex(
      (entry) => entry.kind === "action-started" && entry.actionId === actionId
    );
    const owningVisitIndex = this._latestVisitBoundaryIndexBefore(startedIndex);
    if (owningVisitIndex < 0) return null;

    const nextVisitBoundaryIndex =
      this._nextVisitBoundaryIndex(owningVisitIndex);
    if (nextVisitBoundaryIndex >= this._entries.length) return null;

    const navigation = this._entries[nextVisitBoundaryIndex];
    if (navigation?.kind !== "navigation" || !navigation.startedVisitId)
      return null;

    return { toUrl: navigation.toUrl };
  }

  /** Whether a later visit has closed the window that owns this action. */
  actionOwningVisitHasEnded(actionId: StructuralActionId): boolean {
    const startedIndex = this._entries.findIndex(
      (entry) => entry.kind === "action-started" && entry.actionId === actionId
    );
    if (startedIndex < 0)
      throw new Error(`No recorded action with id ${String(actionId)}.`);

    const owningVisitIndex = this._latestVisitBoundaryIndexBefore(startedIndex);
    if (owningVisitIndex < 0)
      throw new Error(
        "Unable to resolve owning visit for structural action evidence."
      );

    return (
      this._nextVisitBoundaryIndex(owningVisitIndex) < this._entries.length
    );
  }

  private _insert(entry: StructuralTimelineEntry): void {
    let index = this._entries.length;
    while (index > 0 && this._entries[index - 1]!.at > entry.at) index -= 1;
    this._entries.splice(index, 0, entry);
  }

  /** Index of the next same-page visit-opening navigation after `fromIndex`, or the entry count when none follows. */
  private _nextVisitBoundaryIndex(fromIndex: number): number {
    return nextVisitBoundaryIndex(this._entries, fromIndex);
  }

  /** Index of the latest same-page visit-opening navigation positioned before `index`, or -1 when none exists. */
  private _latestVisitBoundaryIndexBefore(index: number): number {
    const pageId = this._entries[index]?.pageId;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const entry = this._entries[cursor]!;
      if (
        entry.kind === "navigation" &&
        entry.startedVisitId !== undefined &&
        entry.pageId === pageId
      )
        return cursor;
    }
    return -1;
  }

  /**
   * Actions whose `action-started` entry sits inside the owning visit's window. The matching
   * `action-completed` entry is looked up globally so a navigating action (completing only after the
   * next same-page visit-opening navigation) is still attributed to its source visit, flagged as crossing
   * the boundary.
   */
  private _windowActions(
    windowEntries: StructuralTimelineEntry[],
    nextVisitBoundaryIndex: number
  ): WindowAction[] {
    const actions: WindowAction[] = [];
    for (const entry of windowEntries) {
      if (entry.kind !== "action-started") continue;
      const completedIndex = this._entries.findIndex(
        (candidate) =>
          candidate.kind === "action-completed" &&
          candidate.actionId === entry.actionId
      );
      if (completedIndex < 0) continue;
      const completed = this._entries[completedIndex];
      if (completed?.kind !== "action-completed") continue;
      actions.push({
        actionId: entry.actionId,
        startedAt: entry.at,
        endedAt: completed.at,
        crossesVisitBoundary: completedIndex >= nextVisitBoundaryIndex,
      });
    }
    return actions.sort((a, b) => a.startedAt - b.startedAt);
  }

  private _latestObservationIndexBefore(
    observations: StructuralObservationEntry[],
    timestamp: number
  ): number | null {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      if (observations[index]!.at < timestamp) return index;
    }
    return null;
  }

  /**
   * Selects the after-boundary observation index for a single action, per the authoritative post-action
   * capture contract documented on {@link getActionEvidence}.
   */
  private _selectAfterIndex(
    observations: StructuralObservationEntry[],
    action: WindowAction,
    context: {
      beforeIndex: number;
      nextActionStart: number | undefined;
      visitWindowClosed: boolean;
    }
  ): number {
    // A crossing action settled on the destination page, so it never has a trustworthy source capture;
    // resolve it against the source window's last known observation (equal before/after stays unchanged).
    if (action.crossesVisitBoundary) return observations.length - 1;

    const explicitIndex = observations.findIndex(
      (obs) => obs.capturedForActionId === action.actionId
    );
    if (explicitIndex < 0) {
      // The window closed after this action without an explicit capture (e.g. navigation skipped it):
      // keep the navigation fallback. With the window still open, a missing capture is invalid state.
      if (context.visitWindowClosed) return observations.length - 1;
      throw new Error(
        `No post-action observation recorded for action ${String(action.actionId)}.`
      );
    }

    const explicit = observations[explicitIndex]!;
    if (
      context.nextActionStart === undefined ||
      explicit.at < context.nextActionStart
    )
      return explicitIndex;

    // The explicit capture only completed after the next action began, so it may already reflect that
    // action. Use the latest genuine post-action poll before the next action; without one the action
    // has no trustworthy after-state and keeps its before-state (an unchanged diff).
    const guardedIndex = this._latestObservationIndexInRange(
      observations,
      action.endedAt,
      context.nextActionStart
    );
    return guardedIndex ?? context.beforeIndex;
  }

  private _latestObservationIndexInRange(
    observations: StructuralObservationEntry[],
    lowerExclusive: number,
    upperExclusive: number
  ): number | null {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      const at = observations[index]!.at;
      if (at > lowerExclusive && at < upperExclusive) return index;
    }
    return null;
  }
}
