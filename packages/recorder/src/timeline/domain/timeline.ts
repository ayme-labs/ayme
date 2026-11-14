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

import type {
  RecordedVisit,
  RecorderWarning,
  TimelineEntry,
} from "../../contract";
import {
  changeText,
  interactionDetails,
  renderPackage,
  wholeTreeText,
  type PackageHeader,
  type TracePoint,
} from "./packageText";
import type {
  PageSnapshot,
  RecordedInteraction,
  TimelineAddition,
  VisitCause,
} from "./recorded";
import { pictureBefore } from "./reportPicture";
import { locateTarget } from "./target";

export type { PackageHeader } from "./packageText";

/** A ref Playwright gave an element, of the page or of a frame in it; core
 * makes up refs of another form for nodes Playwright gave none. */
const BROWSER_REF = /^(f\d+)*e\d+$/;

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
  /** Recording resumes here after a pause: what changed from the snapshot
   * before it is not the recording's. */
  readonly resumes: boolean;
};

/** An Interaction that has no entry yet. */
type Waiting = RecordedInteraction & { readonly id: string };

type Visit = {
  readonly id: string;
  /** The page it is a Visit of. */
  readonly page: string;
  readonly url: string;
  readonly cause: VisitCause;
  readonly snapshots: Kept[];
  /** The Interactions that have no entry yet. */
  readonly waiting: Waiting[];
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

/** The place of a snapshot among a Visit's; negative when it is not there. */
const placeIn = (visit: Visit, snapshot: string | null) =>
  visit.snapshots.findIndex((kept) => kept.snapshot.id === snapshot);

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
 * made: until then a later Interaction may still claim it. What changed
 * while the recorder was paused is left out: after a pause, the snapshot
 * where recording resumes is the point to compare from.
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
  private changes = 0;
  /** Every Interaction taken in, in order, for the trace's sake: whether it
   * left its Visit says whether its "after" is a picture of the same one. */
  private readonly recorded: (RecordedInteraction & {
    readonly id: string;
    readonly leftVisit: boolean;
  })[] = [];
  /** When each snapshot was read. */
  private readonly readAt = new Map<string, number>();
  private told: readonly RecordedVisit[] = [];
  private readonly warned: RecorderWarning[] = [];

  /** What a person should know about how this recording was made. */
  warnings(): readonly RecorderWarning[] {
    return [...this.warned];
  }

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
          page: addition.page,
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
        this.readAt.set(addition.snapshot.id, addition.snapshot.at);
        const visit = this.current.get(addition.snapshot.page);
        if (visit)
          visit.snapshots.push({
            ...(await this.keep(visit, addition.snapshot)),
            resumes: addition.resumes === true,
          });
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
        const recorded = {
          ...interaction,
          id: `interaction_${++this.interactions}`,
        };
        visit.waiting.push(recorded);
        this.recorded.push({
          ...recorded,
          leftVisit:
            interaction.after !== null &&
            !visit.snapshots.some(
              (kept) => kept.snapshot.id === interaction.after
            ),
        });
        // Everything up to it is settled now: what changed before it, and
        // what it changed.
        await this.produce(
          visit,
          visit.snapshots.findIndex(
            (kept) => kept.snapshot.id === interaction.before
          )
        );
        return;
      }
      case "discard":
      case "restore":
        return this.decide(addition.entry, addition.kind === "discard");
    }
  }

  /** Leaves an entry out of the recording, or puts it back. One this
   * timeline does not have is left alone. */
  private decide(id: string, discarded: boolean) {
    for (const visit of this.all) {
      const place = visit.entries.findIndex((entry) => entry.id === id);
      if (place < 0) continue;
      const { discarded: was, ...entry } = visit.entries[place]!;
      if ((was === true) === discarded) return;
      visit.entries[place] = discarded ? { ...entry, discarded: true } : entry;
      this.tell();
      return;
    }
  }

  /**
   * Where the target of an entry is now, for the highlight: on its page,
   * by the ref the page's latest snapshot gives it, which may not be the
   * first ref the package keeps for it; or, for a target with no ref, by
   * its selector. Null for an entry with no target, one of a Visit its page
   * has left, and an element the latest snapshot no longer has.
   */
  liveTarget(entry: string): {
    readonly page: string;
    readonly ref: string | null;
    readonly selector: string | null;
  } | null {
    for (const visit of this.all) {
      const found = visit.entries.find((one) => one.id === entry);
      if (!found) continue;
      if (found.kind !== "interaction") return null;
      if (this.current.get(visit.page) !== visit) return null;
      const { targetRef, targetSelector } = found.interaction;
      const selector = targetSelector ?? null;
      if (targetRef === null)
        return selector === null
          ? null
          : { page: visit.page, ref: null, selector };
      const latest = visit.snapshots.at(-1);
      const now = latest
        ? [...latest.firstRefs].find(([, first]) => first === targetRef)?.[0]
        : undefined;
      // Only a ref the browser gave can name an element of the page.
      if (!now || !BROWSER_REF.test(now)) return null;
      return { page: visit.page, ref: now, selector };
    }
    return null;
  }

  private async keep(
    visit: Visit,
    snapshot: PageSnapshot
  ): Promise<Omit<Kept, "resumes">> {
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
   * What changed before an input known from its report, and what it changed:
   * the report's picture of the page stands between the snapshot before it
   * and its "after". Null when the picture cannot be read so.
   */
  private async fromPicture(
    from: Kept,
    to: Kept,
    interaction: RecordedInteraction
  ): Promise<{
    changedBefore: string;
    changedByIt: string;
    target: AriaRef | undefined;
  } | null> {
    const { target, type } = interaction.report;
    if (!target) return null;
    const pageId = from.observation.pageId;
    const between = await this.session.readChange(
      pageId,
      from.observation,
      to.observation
    );
    const picture = pictureBefore({
      previous: from.tree,
      between,
      picture: target.tree,
      target: target.ref,
      targetAsBefore: type === "fill" || type === "select",
      refs: this.refs,
    });
    if (!picture) return null;
    const [before, after] = await this.session.readIdentityLedger(
      pageId,
      (ledger) => {
        const sameIdentity = (beforeRef: AriaRef, afterRef: AriaRef) =>
          ledger.sameIdentity(beforeRef, afterRef);
        return [
          StructuralTree.reconcile(from.tree, picture.tree, { sameIdentity }),
          StructuralTree.reconcile(picture.tree, to.tree, { sameIdentity }),
        ];
      }
    );
    const firstRefs = new Map([...from.firstRefs, ...to.firstRefs]);
    return {
      changedBefore: changeText(this.underFirstRefs(before!, firstRefs)),
      changedByIt: changeText(this.underFirstRefs(after!, firstRefs)),
      target:
        picture.target && (firstRefs.get(picture.target) ?? picture.target),
    };
  }

  /**
   * Produces a Visit's entries up to the snapshot at `upTo`: the entry of an
   * Interaction that starts at a snapshot on the way, and a change of its
   * own for every other step from one snapshot to the next.
   */
  private async produce(visit: Visit, upTo: number): Promise<void> {
    const before = visit.entries.length;
    while (visit.snapshots[visit.through]) {
      const interaction = this.takeStarting(visit);
      if (interaction) await this.writeInteraction(visit, interaction);
      else if (!(await this.writeStep(visit, upTo))) break;
    }
    if (visit.entries.length > before) this.tell();
  }

  /**
   * Takes the waiting Interaction that starts at the snapshot the entries
   * stand at. One that starts at a snapshot the entries have passed is taken
   * all the same, and written from its own start: no Interaction is left out
   * for where it starts.
   */
  private takeStarting(visit: Visit): Waiting | undefined {
    const starting = visit.waiting.findIndex(
      (interaction) => placeIn(visit, interaction.before) <= visit.through
    );
    return starting < 0 ? undefined : visit.waiting.splice(starting, 1)[0];
  }

  /** Writes an Interaction's entry, and moves the entries on to its "after". */
  private async writeInteraction(
    visit: Visit,
    interaction: Waiting
  ): Promise<void> {
    const from = visit.snapshots[placeIn(visit, interaction.before)]!;
    const end = placeIn(visit, interaction.after);
    const { target, change } = await this.effectOf(
      visit,
      interaction,
      from,
      visit.snapshots[end]
    );
    visit.entries.push({
      kind: "interaction",
      id: interaction.id,
      timestamp: interaction.at,
      interaction: interactionDetails(
        interaction.id,
        interaction.report,
        target ? (from.firstRefs.get(target) ?? target) : null
      ),
      changeTree: change === "" ? null : change,
    });
    if (end > visit.through) visit.through = end;
  }

  /**
   * An Interaction's target and what it changed, from its "before" to its
   * "after"; nothing when it has no "after" in its Visit. For an input known
   * from its report, the report's picture says how the page stood at the
   * moment of the input: what had changed by then is written as a change of
   * its own, ahead of the Interaction. A picture that cannot be read so is
   * warned of, and the input is taken as one the gate held.
   */
  private async effectOf(
    visit: Visit,
    interaction: Waiting,
    from: Kept,
    to: Kept | undefined
  ): Promise<{ target: AriaRef | undefined; change: string }> {
    const held = {
      target: locateTarget(from.tree, interaction.report.target),
      change: to ? changeText(await this.change(from, to)) : "",
    };
    if (!interaction.beforeFromReport || !to) return held;
    const read = await this.fromPicture(from, to, interaction);
    if (!read) {
      this.warned.push({
        kind: "reportShape",
        message: `Playwright's report of ${interaction.id} does not have the shape of a snapshot: it is recorded with what it changed up to its 'after' only.`,
      });
      return held;
    }
    if (read.changedBefore !== "")
      visit.entries.push({
        kind: "change",
        id: `change_${++this.changes}`,
        timestamp: interaction.at,
        changeTree: read.changedBefore,
      });
    return { target: read.target, change: read.changedByIt };
  }

  /**
   * Writes the step from the snapshot the entries stand at to the next one
   * as a change of its own, if anything changed, and moves the entries on.
   * False when there is no step to write: the entries have come to `upTo`,
   * or to the Visit's last snapshot.
   */
  private async writeStep(visit: Visit, upTo: number): Promise<boolean> {
    const through = visit.snapshots[visit.through]!;
    const next = visit.snapshots[visit.through + 1];
    if (visit.through >= upTo || !next) return false;
    // What changed while the recorder was paused is left out: the
    // snapshot where recording resumes is compared with nothing before it.
    const change = next.resumes
      ? ""
      : changeText(await this.change(through, next));
    // Nothing changed: there is nothing to tell.
    if (change !== "")
      visit.entries.push({
        kind: "change",
        id: `change_${++this.changes}`,
        timestamp: next.snapshot.at,
        changeTree: change,
      });
    visit.through += 1;
    return true;
  }

  /**
   * The Recording Package's text, or null when the recording is empty:
   * there is nothing to write then. A recording is empty until an
   * Interaction is recorded, as in the released recorder: a Visit alone,
   * and what the page changed by itself, make no recording. Making the
   * package ends the recording: what changed after the last Interaction of
   * each Visit becomes a change of its own.
   *
   * `positions` says where each snapshot is in the recording's trace, by the
   * snapshot's id; without a trace it is empty, and so is the list of where
   * the trace holds each Interaction.
   */
  async package(
    header: PackageHeader,
    positions: Readonly<Record<string, string>> = {}
  ): Promise<string | null> {
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
    return visits.length === 0
      ? null
      : renderPackage(header, visits, this.tracePoints(positions));
  }

  /** Where the trace holds each Interaction: the position of its "before"
   * and of its "after", for as many as the trace has. */
  private tracePoints(
    positions: Readonly<Record<string, string>>
  ): TracePoint[] {
    if (Object.keys(positions).length === 0) return [];
    return this.recorded.map((interaction) => {
      const before = positions[interaction.before];
      // An Interaction that left its Visit has no "after" in it: the next
      // Visit's first picture shows where it led.
      const after =
        interaction.after === null || interaction.leftVisit
          ? undefined
          : positions[interaction.after];
      return {
        interactionId: interaction.id,
        pageId: interaction.page,
        ...(before === undefined ? {} : { beforeSnapshotId: before }),
        ...(after === undefined ? {} : { afterSnapshotId: after }),
        startedAt: interaction.at,
        endedAt:
          (interaction.after === null
            ? undefined
            : this.readAt.get(interaction.after)) ?? interaction.at,
      };
    });
  }
}
