import {
  isSyntheticRef,
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
  EntryId,
  RecordedVisit,
  RecorderWarning,
  TimelineEntry,
} from "../../contract";
import { foundRows, type FoundRow } from "./changeRows";
import { namedNear, wordsOf, type NamedElement } from "./elementNames";
import {
  interactionDetails,
  leadsToChange,
  renderPackage,
  wholeTreeText,
  type KeptEntry,
  type PackageHeader,
  type TracePoint,
} from "./packageText";
import type {
  ElementLookup,
  PageId,
  PageSnapshot,
  RecordedInteraction,
  SnapshotId,
  TimelineAddition,
  TracePosition,
  VisitCause,
} from "./recorded";
import {
  firstRef,
  isFirst,
  snapshotRef,
  type FirstRef,
  type SnapshotRef,
} from "./refs";
import { pictureBefore } from "./reportPicture";
import { locateTarget } from "./target";

export type { PackageHeader } from "./packageText";

/** A snapshot as the timeline keeps it. */
type Kept = {
  readonly snapshot: PageSnapshot;
  readonly observation: StructuralObservationEntry;
  /** The tree as the browser named it. */
  readonly tree: StructuralTree;
  /** From each ref the browser used here to the first ref its element had. */
  readonly firstRefs: ReadonlyMap<SnapshotRef, FirstRef>;
  /** The tree under first refs: what the package shows. */
  readonly stable: StructuralTree;
  /** Recording resumes here after a pause: what changed from the snapshot
   * before it is not the recording's. */
  readonly resumes: boolean;
};

/** An Interaction that has no entry yet. */
type Waiting = RecordedInteraction & { readonly id: EntryId };

type Visit = {
  readonly id: string;
  /** The page it is a Visit of. */
  readonly page: PageId;
  readonly url: string;
  readonly cause: VisitCause;
  readonly snapshots: Kept[];
  /** The Interactions that have no entry yet. */
  readonly waiting: Waiting[];
  /** The entries produced so far, in order. */
  readonly entries: Entry[];
  /** The place in `snapshots` up to which entries are produced: what
   * changed from this snapshot on is not told yet. */
  through: number;
  /** The place in `snapshots` of the Visit's starting picture: the page as
   * it stood just before the first Interaction in the Visit. Null until
   * there is one: the latest snapshot stands in until then. */
  start: number | null;
  /** From every ref the browser used in this Visit to the element's first. */
  readonly firstRefs: Map<SnapshotRef, FirstRef>;
};

/** Whether a Change Tree has a node that was added, removed or changed
 * itself. */
const changedSomething = (change: StructuralTree) =>
  change.getRootNodes().some(leadsToChange);

/** An entry as the timeline keeps it, with the element each row of its
 * changes names: the one a highlight of the row looks for. */
type Entry = KeptEntry & { readonly rows: readonly (NamedElement | null)[] };

/** A target in its tree, named; null when the tree does not know it. */
const namedTarget = (tree: StructuralTree, ref: AriaRef | undefined) => {
  const node = ref && tree.getNode(ref);
  return node ? namedNear(tree, node) : null;
};

/** The rows of a Change Tree as an entry tells them, and their elements. */
const rowsOf = (change: StructuralTree) => {
  const found: readonly FoundRow[] = foundRows(change);
  return {
    changes: found.map(({ row }) => row),
    rows: found.map(({ element }) => element),
  };
};

/** How the page is asked for an entry's target: by its recorded selector. */
const selectorOf = (entry: TimelineEntry): ElementLookup | null => {
  const selector =
    entry.kind === "interaction" ? entry.interaction.targetSelector : undefined;
  return selector ? { by: "selector", selector } : null;
};

/** How the page is asked for the element a row names: by the ref the
 * Visit's latest snapshot gives it, or else by its role and name. */
function lookupOf(
  visit: Visit,
  element: NamedElement | null | undefined
): ElementLookup | null {
  if (!element) return null;
  const now = [...visit.snapshots.at(-1)!.firstRefs].find(
    ([, first]) => first === element.ref
  )?.[0];
  if (now && !isSyntheticRef(now)) return { by: "ref", ref: now };
  if (element.byText) return { by: "text", text: element.name };
  return { by: "role", role: element.role, name: element.name };
}

/** The place of a snapshot among a Visit's; negative when it is not there. */
const placeIn = (visit: Visit, snapshot: SnapshotId | null) =>
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
  private readonly recorded: (Waiting & {
    /** Its "after" when that is a snapshot of the Visit it started in; null
     * when it has none, or left its Visit. */
    readonly afterInVisit: SnapshotId | null;
  })[] = [];
  /** When each snapshot was read. No snapshot was read at no time. */
  private readonly readAt = new Map<SnapshotId | null, number>();
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
      entries: visit.entries.map(({ entry }) => entry),
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
          id: `interaction_${++this.interactions}` as EntryId,
        };
        visit.waiting.push(recorded);
        this.recorded.push({
          ...recorded,
          afterInVisit: visit.snapshots.some(
            (kept) => kept.snapshot.id === interaction.after
          )
            ? interaction.after
            : null,
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
  private decide(id: EntryId, discarded: boolean) {
    for (const visit of this.all) {
      const place = visit.entries.findIndex(({ entry }) => entry.id === id);
      if (place < 0) continue;
      const kept = visit.entries[place]!;
      const { discarded: was, ...entry } = kept.entry;
      if ((was === true) === discarded) return;
      visit.entries[place] = {
        ...kept,
        entry: discarded ? { ...entry, discarded: true } : entry,
      };
      this.tell();
      return;
    }
  }

  /**
   * Where an element of an entry is now, for the highlight: with no `row`,
   * its target, by the selector Playwright recorded; with `row`, the element
   * that row of its changes names, by the ref the page's latest snapshot
   * gives it, or, when that snapshot no longer lists it, by its role and
   * name. Only a ref the browser gave can name an element of the page: core
   * makes up refs for the nodes the browser gave none. Null for an entry of
   * a Visit its page has left, a target with no selector, and a row the
   * entry does not have or whose element is named by nothing.
   */
  liveTarget(
    entry: EntryId,
    row?: number
  ): { readonly page: PageId; readonly find: ElementLookup } | null {
    for (const visit of this.all) {
      const found = visit.entries.find((one) => one.entry.id === entry);
      if (!found) continue;
      if (this.current.get(visit.page) !== visit) return null;
      const find =
        row === undefined
          ? selectorOf(found.entry)
          : lookupOf(visit, found.rows[row]);
      return find && { page: visit.page, find };
    }
    return null;
  }

  private async keep(
    visit: Visit,
    snapshot: PageSnapshot
  ): Promise<Omit<Kept, "resumes">> {
    // Stryker disable next-line MethodExpression: equivalent, since the clock only gives core's own timeline the time of a navigation, which the timeline never reads back
    this.latestAt = Math.max(this.latestAt, snapshot.at);
    const pageId = PageIdSchema.parse(snapshot.page);
    const tree = StructuralTree.fromAriaSnapshotYaml(snapshot.tree, this.refs);
    const at = MonotonicTimeMsSchema.parse(snapshot.at);
    const observation = this.session.recordObservation({
      // Stryker disable next-line StringLiteral: equivalent, since core reads an entry's kind only for a Visit's or an action's evidence, which the timeline never asks for
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
        const now = new Map<SnapshotRef, FirstRef>();
        /** The element of this snapshot each first ref names: one only. */
        const holder = new Map<FirstRef, SnapshotRef>();
        // Oldest first: a ref comes before every ref that later stood for
        // the same element, so the element that first had it claims it
        // first.
        for (const [ref, first] of visit.firstRefs) {
          // The ledger stands at this snapshot: a ref it resolves is under a
          // ref this tree has.
          const resolved = ledger.resolve(ref);
          // Stryker disable next-line ConditionalExpression: "false" is equivalent, since a ref that is not resolved has no current ref: what is kept under none is never read, and it holds no first ref against another
          if (resolved.status !== "resolved") continue;
          const current = snapshotRef(resolved.currentRef);
          // Core once took two refs for one element, as when the page
          // re-created it, and now has both in one snapshot: two elements.
          // The one that claimed the first ref keeps it; the other is left
          // to its own ref, below, from here on.
          if ((holder.get(first) ?? current) !== current) continue;
          holder.set(first, current);
          now.set(current, first);
        }
        for (const ref of tree.getAllRefs().map(snapshotRef)) {
          if (!now.has(ref)) now.set(ref, firstRef(ref));
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

  /**
   * A tree with each element under its first ref, and no ref twice: one ref
   * names one element in a tree. A tree of what changed between two
   * snapshots can hold an element that stood under another's first ref in
   * the earlier one beside that other, as when the page re-created an
   * element and the original is back. The element that first had the ref
   * keeps it there, and the other is written under its own. How each node
   * of a Change Tree stood before goes with it, under its new ref.
   */
  private underFirstRefs(
    tree: StructuralTree,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>
  ): StructuralTree {
    // A ref no earlier snapshot of the Visit had is the element's first.
    const first = (ref: SnapshotRef) => firstRefs.get(ref) ?? firstRef(ref);
    // The first to claim a ref holds it, unless the element whose own ref it
    // is comes after: that one first had it, and takes it.
    const holder = new Map<FirstRef, SnapshotRef>();
    for (const ref of tree.getAllRefs().map(snapshotRef))
      if (!holder.has(first(ref)) || isFirst(ref, first(ref)))
        holder.set(first(ref), ref);
    const beforeByRef = new Map<AriaRef, StructuralNode>();
    const rename = (node: StructuralNode): StructuralNode => {
      const own = snapshotRef(node.ref);
      // One that does not hold its first ref keeps its own from here on.
      const ref = holder.get(first(own)) === own ? first(own) : firstRef(own);
      const before = tree.getBeforeNode(node.ref);
      // Stryker disable next-line ConditionalExpression: equivalent, since core reads a node recorded as null and one not recorded alike
      if (before) beforeByRef.set(ref, before);
      return node.copy({
        ref,
        children: node.children.map((child) =>
          typeof child === "string" ? child : rename(child)
        ),
      });
    };
    const root = rename(tree.root);
    return new StructuralTree(root, this.refs, {
      beforeByRef,
      beforeByAfterRef: new Map(),
      ambiguousBeforeRefs: new Set(),
    });
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
    changedBefore: StructuralTree;
    changedByIt: StructuralTree;
    target: FirstRef | undefined;
    named: NamedElement | null;
  } | null> {
    const { target, type, selector } = interaction.report;
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
      selector,
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
        // Stryker disable next-line ObjectLiteral: equivalent, since the picture's tree has every element the earlier snapshot shares with it under that snapshot's ref, which leaves no pair for the record to deny
        const sinceBefore = { sameIdentity };
        return [
          StructuralTree.reconcile(from.tree, picture.tree, sinceBefore),
          StructuralTree.reconcile(picture.tree, to.tree, { sameIdentity }),
        ];
      }
    );
    const firstRefs = new Map([...from.firstRefs, ...to.firstRefs]);
    return {
      changedBefore: this.underFirstRefs(before!, firstRefs),
      changedByIt: this.underFirstRefs(after!, firstRefs),
      target:
        picture.target &&
        (firstRefs.get(picture.target) ?? firstRef(picture.target)),
      named: namedTarget(picture.tree, picture.target),
    };
  }

  /**
   * Produces a Visit's entries up to the snapshot at `upTo`, or to its last
   * one: the entry of an Interaction that starts at a snapshot on the way,
   * and a change of its own for every other step from one snapshot to the
   * next.
   */
  private async produce(visit: Visit, upTo = Infinity): Promise<void> {
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
    const { target, named, change } = await this.effectOf(
      visit,
      interaction,
      from,
      visit.snapshots[end]
    );
    const changed = change && changedSomething(change) ? change : null;
    const told = changed && rowsOf(changed);
    visit.entries.push({
      entry: {
        kind: "interaction",
        id: interaction.id,
        timestamp: interaction.at,
        interaction: interactionDetails(
          interaction.id,
          interaction.report,
          target ?? null
        ),
        ...(named ? { targetElement: wordsOf(named) } : {}),
        changes: told && told.changes,
      },
      change: changed,
      rows: told ? told.rows : [],
    });
    // The entries never go back: an Interaction with no "after" here, or
    // one written late, leaves them where they stand.
    visit.through = Math.max(visit.through, end);
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
  ): Promise<{
    target: FirstRef | undefined;
    named: NamedElement | null;
    change: StructuralTree | null;
  }> {
    const located = locateTarget(from.tree, interaction.report);
    const held = {
      // Every ref of a kept snapshot has its first ref.
      target: located && from.firstRefs.get(located),
      named: namedTarget(from.tree, located),
      change: to ? await this.change(from, to) : null,
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
    if (changedSomething(read.changedBefore))
      this.writeChange(visit, interaction.at, read.changedBefore);
    return { target: read.target, named: read.named, change: read.changedByIt };
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
    // Stryker disable next-line EqualityOperator: ">" is equivalent, since at `upTo` itself an Interaction starts, or the Visit ends
    const reached = visit.through >= upTo;
    if (reached || !next) return false;
    // What changed while the recorder was paused is left out: the
    // snapshot where recording resumes is compared with nothing before it.
    const change = next.resumes ? null : await this.change(through, next);
    // Nothing changed: there is nothing to tell.
    if (change && changedSomething(change))
      this.writeChange(visit, next.snapshot.at, change);
    visit.through += 1;
    return true;
  }

  /** Writes a change of its own: one no Interaction explains. */
  private writeChange(visit: Visit, at: number, change: StructuralTree) {
    const id = `change_${++this.changes}` as EntryId;
    const { changes, rows } = rowsOf(change);
    visit.entries.push({
      entry: { kind: "change", id, timestamp: at, changes },
      change,
      rows,
    });
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
    positions: Readonly<Record<SnapshotId, TracePosition>> = {}
  ): Promise<string | null> {
    if (this.interactions === 0) return null;
    const visits = [];
    for (const visit of this.all) {
      if (visit.snapshots.length === 0) continue;
      if (visit.start === null)
        visit.through = visit.start = visit.snapshots.length - 1;
      const first = visit.snapshots[visit.start]!;
      await this.produce(visit);
      visits.push({
        visitId: visit.id,
        url: visit.url,
        cause: visit.cause,
        entries: visit.entries,
        baselineTree: wholeTreeText(first.stable),
      });
    }
    return renderPackage(header, visits, this.tracePoints(positions));
  }

  /** Where the trace holds each Interaction: the position of its "before"
   * and of its "after", for as many as the trace has. */
  private tracePoints(
    positions: Readonly<Record<SnapshotId, TracePosition>>
  ): TracePoint[] {
    if (Object.keys(positions).length === 0) return [];
    // No snapshot has no position, like a snapshot the trace does not hold.
    const position: ReadonlyMap<string | null, TracePosition> = new Map(
      Object.entries(positions)
    );
    return this.recorded.map((interaction) => ({
      interactionId: interaction.id,
      pageId: interaction.page,
      // A field with no value is left out of the package.
      beforeSnapshotId: position.get(interaction.before),
      // An Interaction that left its Visit has no "after" in it: the next
      // Visit's first picture shows where it led.
      afterSnapshotId: position.get(interaction.afterInVisit),
      startedAt: interaction.at,
      endedAt: this.readAt.get(interaction.after) ?? interaction.at,
    }));
  }
}
