import type { StructuralActionId } from "./StructuralAction";
import type { VisitId, VisitStartedCause } from "./Visit";
import {
  MonotonicTimeMsSchema,
  type MonotonicTimeMs,
} from "../capture/MonotonicTimeMs";
import type { PageId } from "../capture/PageId";
import {
  StructuralTimeline,
  normalizeNavigationUrl,
  startsNewVisit,
  type StructuralVisitSnapshot,
  type StructuralActionCompletedEntry,
  type StructuralActionStartedEntry,
  type StructuralActionTimelineEvidence,
  type StructuralTreeEvidenceResolver,
  type StructuralNavigationEntry,
  type StructuralObservationEntry,
  type StructuralVisitOpeningNavigationEntry,
  type StructuralVisitTimelineEvidence,
} from "./StructuralTimeline";
import { VisitIdFactory } from "./VisitIdFactory";
import {
  StructuralIdentityLedger,
  type StructuralLifecycleMoment,
} from "./StructuralIdentityLedger";

export type { StructuralVisitSnapshot } from "./StructuralTimeline";

/** A page's identity ledger and the observations it has not reconciled yet. */
type PageIdentities = {
  readonly ledger: StructuralIdentityLedger;
  readonly pending: {
    entry: StructuralObservationEntry;
    moment: StructuralLifecycleMoment;
  }[];
  /** The observation the ledger last reconciled. */
  through: StructuralObservationEntry | null;
  drained: Promise<unknown>;
};

export type StructuralObservationSessionOptions = {
  clock: { now(): number };
};

export type NavigationSignal = {
  pageId: PageId;
  url: string;
  cause: VisitStartedCause;
};

export type NavigationRegistration =
  | { kind: "ignored" }
  | { kind: "navigation-recorded"; entry: StructuralNavigationEntry }
  | {
      kind: "visit-started";
      entry: StructuralVisitOpeningNavigationEntry;
      visit: StructuralVisitSnapshot;
    };

export type PreparedNavigation = {
  registration: NavigationRegistration;
  commit(): NavigationRegistration;
};

export class StructuralObservationSession {
  private readonly _visitIdSource = new VisitIdFactory();
  private readonly _clock: { now(): number };
  private _timeline: StructuralTimeline;
  private _identities = new Map<PageId, PageIdentities>();

  constructor(options: StructuralObservationSessionOptions) {
    this._clock = options.clock;
    this._timeline = new StructuralTimeline();
  }

  recordNavigation(signal: NavigationSignal): NavigationRegistration {
    return this.prepareNavigation(signal).commit();
  }

  prepareNavigation(signal: NavigationSignal): PreparedNavigation {
    const fromUrl = this._timeline.latestNavigationUrlForPage(signal.pageId);
    const url = signal.url;

    if (
      fromUrl !== null &&
      normalizeNavigationUrl(fromUrl) === normalizeNavigationUrl(url)
    ) {
      const registration = { kind: "ignored" } as const;
      return { registration, commit: () => registration };
    }

    const startedAt = this._monotonicNow();
    let committed = false;

    if (!startsNewVisit(fromUrl, url)) {
      const entry = {
        kind: "navigation",
        at: startedAt,
        pageId: signal.pageId,
        fromUrl,
        toUrl: url,
        cause: signal.cause,
      } as const;
      const registration = { kind: "navigation-recorded", entry } as const;
      return {
        registration,
        commit: () => {
          if (!committed) {
            this._timeline.recordNavigation(entry);
            committed = true;
          }
          return registration;
        },
      };
    }

    const visitId = this._visitIdSource.create();
    const entry: StructuralVisitOpeningNavigationEntry = {
      kind: "navigation",
      at: startedAt,
      pageId: signal.pageId,
      fromUrl,
      toUrl: url,
      cause: signal.cause,
      startedVisitId: visitId,
    };
    const visit: StructuralVisitSnapshot = {
      id: visitId,
      pageId: signal.pageId,
      urls: [url],
    };
    const registration = { kind: "visit-started", entry, visit } as const;
    return {
      registration,
      commit: () => {
        if (!committed) {
          this._timeline.recordNavigation(entry);
          committed = true;
        }
        return registration;
      },
    };
  }

  recordObservation(
    entry: StructuralObservationEntry
  ): StructuralObservationEntry {
    this._timeline.recordObservation(entry);
    this._pageIdentities(entry.pageId).pending.push({
      entry,
      moment: {
        visitId: this._timeline.currentVisitIdForPage(entry.pageId),
        afterActionId:
          entry.capturedForActionId ??
          this._timeline.latestActionStartedForPage(entry.pageId),
      },
    });
    return entry;
  }

  recordActionStarted(
    entry: StructuralActionStartedEntry
  ): StructuralActionStartedEntry {
    return this._timeline.recordActionStarted(entry);
  }

  /**
   * Read the page's identity ledger once every observation recorded so far is
   * reconciled into it, in recording order. Continuity runs through every
   * observation of the page, across its Visits; each appearance and
   * disappearance names its Visit and the action it followed.
   *
   * `read` runs in the same step as the last reconcile and receives the
   * observation the ledger now stands at, so a caller can pair the ledger's
   * current refs with that observation's own data. Reads are serialized.
   *
   * The ledger is its own reconciliation chain, run lazily here: one
   * reconcile per recorded observation, against the page's previous one. An
   * observation whose tree fails to resolve fails the read and stays pending,
   * so lineage is never skipped over.
   */
  async readIdentityLedger<T>(
    pageId: PageId,
    read: (
      ledger: StructuralIdentityLedger,
      through: StructuralObservationEntry | null
    ) => T
  ): Promise<T> {
    const page = this._pageIdentities(pageId);
    const result = page.drained
      .catch(() => {})
      .then(async () => {
        while (page.pending.length > 0) {
          const { entry, moment } = page.pending[0]!;
          page.ledger.advance(await entry.tree.resolve(), moment);
          page.pending.shift();
          page.through = entry;
        }
        return read(page.ledger, page.through);
      });
    page.drained = result;
    return result;
  }

  recordActionCompleted(
    entry: StructuralActionCompletedEntry
  ): StructuralActionCompletedEntry {
    return this._timeline.recordActionCompleted(entry);
  }

  currentVisitIdForPage(pageId: PageId): VisitId | null {
    return this._timeline.currentVisitIdForPage(pageId);
  }

  async getVisitEvidence(
    visitId: VisitId,
    resolveTree?: StructuralTreeEvidenceResolver
  ): Promise<StructuralVisitTimelineEvidence> {
    return this._timeline.getVisitEvidence(visitId, resolveTree);
  }

  async getActionEvidence(
    actionId: StructuralActionId,
    resolveTree?: StructuralTreeEvidenceResolver
  ): Promise<StructuralActionTimelineEvidence> {
    return this._timeline.getActionEvidence(actionId, resolveTree);
  }

  actionCrossedVisitBoundary(actionId: StructuralActionId): boolean {
    return this._timeline.actionCrossedVisitBoundary(actionId);
  }

  actionOwningVisitId(actionId: StructuralActionId): VisitId {
    return this._timeline.actionOwningVisitId(actionId);
  }

  actionOwningVisitHasEnded(actionId: StructuralActionId): boolean {
    return this._timeline.actionOwningVisitHasEnded(actionId);
  }

  getNavigationSignalForAction(
    actionId: StructuralActionId
  ): { toUrl: string } | null {
    return this._timeline.getNavigationSignalForAction(actionId);
  }

  getVisits(): StructuralVisitSnapshot[] {
    return [...this._timeline.visits()];
  }

  reset(): void {
    this._timeline = new StructuralTimeline();
    this._visitIdSource.reset();
    this._identities = new Map();
  }

  private _pageIdentities(pageId: PageId): PageIdentities {
    let page = this._identities.get(pageId);
    if (!page) {
      page = {
        ledger: new StructuralIdentityLedger(),
        pending: [],
        through: null,
        drained: Promise.resolve(),
      };
      this._identities.set(pageId, page);
    }
    return page;
  }

  private _monotonicNow(): MonotonicTimeMs {
    return MonotonicTimeMsSchema.parse(this._clock.now());
  }
}
