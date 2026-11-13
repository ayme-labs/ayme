import {
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralObservationSession,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralNode,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";

import type { RecordedVisit, TimelineEntry } from "../../contract";
import {
  changeText,
  interactionDetails,
  renderPackage,
  wholeTreeText,
  type PackageHeader,
} from "./packageText";
import type {
  PageSnapshot,
  RecordedInteraction,
  TimelineAddition,
  VisitCause,
} from "./recorded";
import { locateTarget } from "./target";

export type { PackageHeader } from "./packageText";

/** A snapshot as the timeline keeps it. */
type Kept = {
  readonly snapshot: PageSnapshot;
  readonly observation: StructuralObservationEntry;
  /** The tree as the browser named it. */
  readonly tree: StructuralTree;
  /** From each ref the browser used here to the first ref its element had. */
  readonly firstRefs: ReadonlyMap<AriaRef, AriaRef>;
  /** The tree under first refs: what the package shows. */
  readonly stable: StructuralTree;
};

type Visit = {
  readonly id: string;
  readonly url: string;
  readonly cause: VisitCause;
  readonly snapshots: Kept[];
  /** The Interactions that have no entry yet. */
  readonly waiting: (RecordedInteraction & { readonly id: string })[];
  /** The entries produced so far, in order. */
  readonly entries: TimelineEntry[];
  /** The place in `snapshots` up to which entries are produced: what
   * changed from this snapshot on is not told yet. */
  through: number;
  /** The place in `snapshots` of the Visit's starting picture: the page as
   * it stood just before the first Interaction in the Visit. Null until
   * there is one: the latest snapshot stands in until then. */
  start: number | null;
  /** From every ref the browser used in this Visit to the element's first. */
  readonly firstRefs: Map<AriaRef, AriaRef>;
};

/**
 * The timeline of one recording: Visits, snapshots and Interactions in, the
 * Visits with their entries out, as they are produced, and the Recording
 * Package at the end. Visits and the identity of an element across snapshots
 * are core's observation session's; the Change Trees are core's.
 *
 * A Visit's starting picture is the snapshot just before its first
 * Interaction, or its last one when it has none: what the page rendered
 * before is no change. From there on, what
 * changed between a snapshot and the next is an Interaction's when the two
 * are its "before" and its "after", and a change of its own otherwise. An
 * Interaction's entry is produced when the Interaction is added. A change of
 * its own is produced with the next Interaction, or when the package is
 * made: until then a later Interaction may still claim it.
 *
 * Additions are taken one at a time, in the order they happened: wait for
 * one before adding the next.
 */
export class Timeline {
  // One factory for the recording, so that the refs core makes up for nodes
  // the browser gave none never collide across trees.
  private readonly refs = new SyntheticAriaRefFactory();
  private latestAt = 0;
  private readonly session = new StructuralObservationSession({
    clock: { now: () => this.latestAt },
  });
  private readonly all: Visit[] = [];
  /** The Visit each page is in. */
  private readonly current = new Map<string, Visit>();
  private interactions = 0;
  private told: readonly RecordedVisit[] = [];

  /**
   * The Visits with the entries produced so far, as plain data. It is the
   * same list until a Visit or an entry is added.
   */
  visits(): readonly RecordedVisit[] {
    return this.told;
  }

  private tell() {
    this.told = this.all.map((visit) => ({
      visitId: visit.id,
      url: visit.url,
      cause: visit.cause,
      entries: [...visit.entries],
    }));
  }

  async add(addition: TimelineAddition): Promise<void> {
    switch (addition.kind) {
      case "visit": {
        const registered = this.session.recordNavigation({
          pageId: PageIdSchema.parse(addition.page),
          url: addition.url,
          cause: addition.cause,
        });
        if (registered.kind !== "visit-started") return;
        const visit: Visit = {
          id: registered.visit.id,
          url: addition.url,
          cause: addition.cause,
          snapshots: [],
          waiting: [],
          entries: [],
          through: 0,
          start: null,
          firstRefs: new Map(),
        };
        this.all.push(visit);
        this.current.set(addition.page, visit);
        this.tell();
        return;
      }
      case "snapshot": {
        const visit = this.current.get(addition.snapshot.page);
        if (visit)
          visit.snapshots.push(await this.keep(visit, addition.snapshot));
        return;
      }
      case "interaction": {
        const { interaction } = addition;
        // The Visit it started in: one that leaves the page has its "after"
        // in the next Visit.
        const visit = this.all.find((started) =>
          started.snapshots.some(
            (kept) => kept.snapshot.id === interaction.before
          )
        );
        if (!visit) return;
        if (visit.start === null) {
          visit.start = visit.snapshots.findIndex(
            (kept) => kept.snapshot.id === interaction.before
          );
          visit.through = visit.start;
        }
        visit.waiting.push({
          ...interaction,
          id: `interaction_${++this.interactions}`,
        });
        // Everything up to it is settled now: what changed before it, and
        // what it changed.
        await this.produce(
          visit,
          visit.snapshots.findIndex(
            (kept) => kept.snapshot.id === interaction.before
          )
        );
      }
    }
  }

  private async keep(visit: Visit, snapshot: PageSnapshot): Promise<Kept> {
    this.latestAt = Math.max(this.latestAt, snapshot.at);
    const pageId = PageIdSchema.parse(snapshot.page);
    const tree = StructuralTree.fromAriaSnapshotYaml(snapshot.tree, this.refs);
    const at = MonotonicTimeMsSchema.parse(snapshot.at);
    const observation = this.session.recordObservation({
      kind: "observation",
      at,
      pageId,
      tree: { pageId, capturedAt: at, resolve: () => Promise.resolve(tree) },
    });
    // Core says which element of this snapshot is which element of the
    // earlier ones; the package names each by the first ref it had.
    const firstRefs = await this.session.readIdentityLedger(
      pageId,
      (ledger) => {
        const now = new Map<AriaRef, AriaRef>();
        for (const [ref, first] of visit.firstRefs) {
          const resolved = ledger.resolve(ref);
          if (
            resolved.status === "resolved" &&
            tree.hasNode(resolved.currentRef)
          )
            now.set(resolved.currentRef, first);
        }
        for (const ref of tree.getAllRefs()) {
          if (!now.has(ref)) now.set(ref, ref);
          visit.firstRefs.set(ref, now.get(ref)!);
        }
        return now;
      }
    );
    return {
      snapshot,
      observation,
      tree,
      firstRefs,
      stable: this.underFirstRefs(tree, firstRefs),
    };
  }

  private underFirstRefs(
    tree: StructuralTree,
    firstRefs: ReadonlyMap<AriaRef, AriaRef>
  ): StructuralTree {
    const rename = (node: StructuralNode): StructuralNode =>
      node.copy({
        ref: firstRefs.get(node.ref) ?? node.ref,
        children: node.children.map((child) =>
          typeof child === "string" ? child : rename(child)
        ),
      });
    return new StructuralTree(rename(tree.root), this.refs);
  }

  /** What changed on the page from one kept snapshot to a later one. */
  private async change(from: Kept, to: Kept): Promise<StructuralTree> {
    const change = await this.session.readChange(
      from.observation.pageId,
      from.observation,
      to.observation
    );
    return this.underFirstRefs(
      change,
      new Map([...from.firstRefs, ...to.firstRefs])
    );
  }

  /**
   * Produces a Visit's entries up to the snapshot at `upTo`: the entry of an
   * Interaction that starts at a snapshot on the way, and a change of its
   * own for every other step from one snapshot to the next.
   */
  private async produce(visit: Visit, upTo: number): Promise<void> {
    const { snapshots, entries } = visit;
    const before = entries.length;
    for (;;) {
      const from = snapshots[visit.through];
      if (!from) break;
      const starting = visit.waiting.findIndex(
        (interaction) => interaction.before === from.snapshot.id
      );
      if (starting >= 0) {
        const [interaction] = visit.waiting.splice(starting, 1);
        const end = snapshots.findIndex(
          (kept) => kept.snapshot.id === interaction!.after
        );
        const targetRef = locateTarget(from.tree, interaction!.report.target);
        const change =
          end < 0 ? "" : changeText(await this.change(from, snapshots[end]!));
        entries.push({
          kind: "interaction",
          timestamp: interaction!.at,
          interaction: interactionDetails(
            interaction!.id,
            interaction!.report,
            targetRef ? (from.firstRefs.get(targetRef) ?? targetRef) : null
          ),
          changeTree: change === "" ? null : change,
        });
        if (end > visit.through) visit.through = end;
        continue;
      }
      const next = snapshots[visit.through + 1];
      if (visit.through >= upTo || !next) break;
      const change = changeText(await this.change(from, next));
      // Nothing changed: there is nothing to tell.
      if (change !== "")
        entries.push({
          kind: "change",
          timestamp: next.snapshot.at,
          changeTree: change,
        });
      visit.through += 1;
    }
    if (entries.length > before) this.tell();
  }

  /**
   * The Recording Package's text, or null when the recording is empty:
   * there is nothing to write then. A recording is empty until an
   * Interaction is recorded, as in the released recorder: a Visit alone,
   * and what the page changed by itself, make no recording. Making the
   * package ends the recording: what changed after the last Interaction of
   * each Visit becomes a change of its own.
   */
  async package(header: PackageHeader): Promise<string | null> {
    if (this.interactions === 0) return null;
    const visits = [];
    for (const visit of this.all) {
      if (visit.snapshots.length === 0) continue;
      if (visit.start === null)
        visit.through = visit.start = visit.snapshots.length - 1;
      const first = visit.snapshots[visit.start]!;
      await this.produce(visit, visit.snapshots.length - 1);
      visits.push({
        visitId: visit.id,
        url: visit.url,
        cause: visit.cause,
        entries: visit.entries,
        baselineTree: wholeTreeText(first.stable),
      });
    }
    return visits.length === 0 ? null : renderPackage(header, visits);
  }
}
