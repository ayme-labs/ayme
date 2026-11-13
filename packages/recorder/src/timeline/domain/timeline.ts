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

import { renderPackage, type PackageHeader } from "./packageText";
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
  readonly page: string;
  readonly url: string;
  readonly cause: VisitCause;
  readonly snapshots: Kept[];
  readonly interactions: (RecordedInteraction & { readonly id: string })[];
  /** From every ref the browser used in this Visit to the element's first. */
  readonly firstRefs: Map<AriaRef, AriaRef>;
};

/**
 * The timeline of one recording: Visits, snapshots and Interactions in, the
 * Recording Package out. Visits and the identity of an element across
 * snapshots are core's observation session's; the Change Trees are core's.
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
  private readonly visits: Visit[] = [];
  /** The Visit each page is in. */
  private readonly current = new Map<string, Visit>();
  private interactions = 0;

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
          page: addition.page,
          url: addition.url,
          cause: addition.cause,
          snapshots: [],
          interactions: [],
          firstRefs: new Map(),
        };
        this.visits.push(visit);
        this.current.set(addition.page, visit);
        return;
      }
      case "snapshot": {
        const visit = this.current.get(addition.snapshot.page);
        if (visit)
          visit.snapshots.push(await this.keep(visit, addition.snapshot));
        return;
      }
      case "interaction":
        this.current.get(addition.interaction.page)?.interactions.push({
          ...addition.interaction,
          id: `interaction_${++this.interactions}`,
        });
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
   * The Recording Package's text, or null when no page was read: there is
   * nothing to write then.
   *
   * A Visit's first snapshot is its starting picture. From there on, what
   * changed between a snapshot and the next is an Interaction's when the two
   * are its "before" and its "after", and a change of its own otherwise.
   */
  async package(header: PackageHeader): Promise<string | null> {
    const visits = [];
    for (const visit of this.visits) {
      const [first] = visit.snapshots;
      if (!first) continue;
      visits.push({
        visitId: visit.id,
        url: visit.url,
        cause: visit.cause,
        baselineTree: first.stable,
        timelineEntries: await this.entries(visit),
      });
    }
    return visits.length === 0 ? null : renderPackage(header, visits);
  }

  private async entries(visit: Visit) {
    const { snapshots } = visit;
    const position = new Map(
      snapshots.map((kept, index) => [kept.snapshot.id, index])
    );
    const entries = [];
    for (let index = 0; index < snapshots.length;) {
      const from = snapshots[index]!;
      const interaction = visit.interactions.find(
        (candidate) => candidate.before === from.snapshot.id
      );
      const end =
        interaction?.after == null
          ? undefined
          : position.get(interaction.after);
      const after = end === undefined ? undefined : snapshots[end]!;
      if (interaction) {
        const targetRef = locateTarget(from.tree, interaction.report.target);
        entries.push({
          kind: "interaction" as const,
          timestamp: interaction.at,
          id: interaction.id,
          report: interaction.report,
          targetRef: targetRef && (from.firstRefs.get(targetRef) ?? targetRef),
          changeTree: after ? await this.change(from, after) : null,
        });
      }
      if (end !== undefined && end > index) {
        index = end;
        continue;
      }
      const next = snapshots[index + 1];
      if (next)
        entries.push({
          kind: "change" as const,
          timestamp: next.snapshot.at,
          changeTree: await this.change(from, next),
        });
      index += 1;
    }
    return entries;
  }
}
