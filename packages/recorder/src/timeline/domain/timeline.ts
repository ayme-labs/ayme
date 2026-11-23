import {
  isSyntheticRef,
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralObservationSession,
  StructuralTree,
  startsNewVisit,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralNode,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";

import type { EntryId, RecordedVisit, RecorderWarning } from "../../contract";
import { foundRows, type FoundRow } from "./changeRows";
import {
  labelNear,
  selectorWords,
  withPageBefore,
  wordsOf,
  type NamedElement,
} from "./elementNames";
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
import type { InteractionReport } from "./recorded";
import {
  firstRef,
  isFirst,
  snapshotRef,
  type FirstRef,
  type SnapshotRef,
} from "./refs";
import { pictureBefore, type PictureBefore } from "./reportPicture";
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
type Waiting = RecordedInteraction & {
  readonly id: EntryId;
  readonly key?: string;
};

/**
 * Playwright's picture of the page at an input's first report, matched with
 * its "before" alone, as when the input shows before the page is read
 * again. An element the picture has and the "before" has not gets a ref of
 * its own, and is tied to the ref a later read gives it once one does.
 */
type Pictured = {
  readonly picture: PictureBefore;
  /** From a ref of the picture's own to the later read's ref it is tied to. */
  readonly tied: Map<AriaRef, AriaRef>;
};

/** An Interaction's entry, as it is measured again when it is replaced. */
type Written = {
  readonly visit: Visit;
  readonly id: EntryId;
  readonly from: Kept;
  /** As it was first added: its report holds the picture it is measured
   * from. */
  readonly first: RecordedInteraction;
  /** Where the entries stood once what changed before it was written. */
  readonly throughAtStart: number;
  /** Null for an input measured from its "before", as a held one is. */
  readonly pictured: Pictured | null;
  /** The change of its own the picture showed ahead of it, if any. */
  readonly changedBefore: EntryId | null;
  /** Its target and how it is named, as last measured. */
  target: FirstRef | undefined;
  named: NamedElement | null;
  /** What it was last measured as, up to which "after", and the report it
   * was last written with. */
  measured?: {
    readonly after: SnapshotId | null;
    readonly as: Measured;
    readonly report: InteractionReport;
  };
};

/** What an Interaction's entry is measured as. */
type Measured = {
  readonly target: FirstRef | undefined;
  readonly named: NamedElement | null;
  readonly change: StructuralTree | null;
};

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
type Entry = KeptEntry & {
  readonly rows: readonly (NamedElement | null)[];
  /** Its target ref is the nearest ancestor the report's picture lists:
   * the picture does not list the element itself. */
  readonly byAncestor?: true;
};

/** A target in its tree, named; null when the tree does not know it. */
const namedTarget = (tree: StructuralTree, ref: AriaRef | undefined) => {
  const node = ref && tree.getNode(ref);
  return node ? labelNear(tree, node) : null;
};

/** An entry's target in words: its label, or else its selector's words. */
function targetWords(
  named: NamedElement | null,
  report: InteractionReport
): { targetElement?: string } {
  const words = named
    ? wordsOf(named)
    : selectorWords(report.selector, report.locator);
  return words ? { targetElement: words } : {};
}

/** The rows of a Change Tree as an entry tells them, and their elements. */
const rowsOf = (change: StructuralTree) => {
  const found: readonly FoundRow[] = foundRows(change);
  return {
    changes: found.map(({ row }) => row),
    rows: found.map(({ element }) => element),
  };
};

/** The ref the Visit's latest snapshot gives an element known by its first
 * ref: none once the page has left the Visit, whose refs name nothing in
 * the document it has now, and none core made up, which name no element of
 * the page. */
function refNow(
  visit: Visit,
  first: string | null | undefined,
  left: boolean
): ElementLookup | null {
  if (left || !first) return null;
  const now = [...visit.snapshots.at(-1)!.firstRefs].find(
    ([, kept]) => kept === first
  )?.[0];
  return now && !isSyntheticRef(now) ? { by: "ref", ref: now } : null;
}

/** How the page is asked for an entry's target: by the ref the Visit's
 * latest snapshot gives it while the page is still on the Visit, or else
 * by its recorded selector; by the selector first when the ref is an
 * ancestor's, which would light more than the element. */
function targetLookupOf(
  visit: Visit,
  { entry, byAncestor }: Entry,
  left: boolean
): ElementLookup | null {
  if (entry.kind !== "interaction") return null;
  const { targetRef, targetSelector } = entry.interaction;
  const bySelector: ElementLookup | null = targetSelector
    ? { by: "selector", selector: targetSelector }
    : null;
  return byAncestor
    ? (bySelector ?? refNow(visit, targetRef, left))
    : (refNow(visit, targetRef, left) ?? bySelector);
}

/** How the page is asked for the element a row names: by the ref the
 * Visit's latest snapshot gives it, or else, and always once the page has
 * left the Visit, by the selector of its label. */
function lookupOf(
  visit: Visit,
  element: NamedElement | null | undefined,
  left: boolean
): ElementLookup | null {
  if (!element) return null;
  return (
    refNow(visit, element.ref, left) ?? {
      by: "selector",
      selector: element.selector,
    }
  );
}

/** Whether a read taken at the address `read` is of the document a page at
 * `page` shows: a change of the address's query or hash alone keeps the
 * document, as it keeps the Visit. */
export const sameDocument = (page: string, read: string) =>
  !startsNewVisit(page, read);

/** The reports of an input whose press can move the focus before the gate
 * holds it. */
const PRESSED = new Set(["click", "check", "uncheck"]);

/** Whether two reports say the same: the one object, or the same text. */
const sameReport = (one: InteractionReport, other: InteractionReport) =>
  one === other || JSON.stringify(one) === JSON.stringify(other);

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
  /** The entries added under a key, by their key. */
  private readonly byKey = new Map<string, Written>();
  /** The read before a click whose press moved the focus, by its id: the
   * page as it stood just before the press, the focus where it was. */
  private readonly beforePress = new Map<SnapshotId, StructuralTree>();
  /** The Interaction whose "after" each read is, as last written. */
  private readonly endingAt = new Map<
    SnapshotId,
    { readonly written: Written; readonly interaction: RecordedInteraction }
  >();
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
      case "visit":
        return this.startVisit(addition);
      case "snapshot":
        return this.keepRead(addition);
      case "interaction":
        return this.addInteraction(addition);
      case "elsewhere": {
        const left = this.current.get(addition.page);
        // Continue starts its Visit there, as the address says.
        if (left && startsNewVisit(left.url, addition.url))
          this.current.delete(addition.page);
        return;
      }
      case "text": {
        const added = this.byKey.get(addition.key);
        if (added) this.retext(added, addition.report);
        return;
      }
      case "discard":
      case "restore":
        return this.decide(addition.entry, addition.kind === "discard");
    }
  }

  /** A Visit starts, when core takes it for one. */
  private startVisit(addition: Extract<TimelineAddition, { kind: "visit" }>) {
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
  }

  /** A read of a page, kept in the Visit the page is in. */
  private async keepRead(
    addition: Extract<TimelineAddition, { kind: "snapshot" }>
  ) {
    this.readAt.set(addition.snapshot.id, addition.snapshot.at);
    // A read of a document the page has left, as one a navigation overtook,
    // or of the blank page, is none of the Visit of where the page went.
    const visit = this.current.get(addition.snapshot.page);
    if (visit && sameDocument(visit.url, addition.snapshot.url))
      visit.snapshots.push({
        ...(await this.keep(visit, addition.snapshot)),
        resumes: addition.resumes === true,
      });
  }

  /** An Interaction: a new one waits in the Visit it started in, and
   * everything up to it is produced; one added under a key already is
   * replaced. */
  private async addInteraction(
    addition: Extract<TimelineAddition, { kind: "interaction" }>
  ) {
    const { interaction, key } = addition;
    const added = key === undefined ? undefined : this.byKey.get(key);
    if (added) return this.replace(added, interaction);
    // The Visit it started in: one that leaves the page has its "after" in
    // the next Visit.
    const visit = this.all.find((started) =>
      started.snapshots.some((kept) => kept.snapshot.id === interaction.before)
    );
    if (!visit) return;
    const start = placeIn(visit, interaction.before);
    if (visit.start === null) {
      visit.start = start;
      visit.through = start;
    }
    const recorded: Waiting = {
      ...interaction,
      id: `interaction_${++this.interactions}` as EntryId,
      ...(key === undefined ? {} : { key }),
    };
    visit.waiting.push(recorded);
    this.recorded.push({
      ...recorded,
      afterInVisit:
        placeIn(visit, interaction.after) >= 0 ? interaction.after : null,
    });
    // Everything up to it is settled now: what changed before it, and what
    // it changed.
    await this.produce(visit, start);
  }

  /** An entry added under a key, measured again up to its new "after", with
   * its new text, in its place. */
  private async replace(written: Written, interaction: RecordedInteraction) {
    const { visit } = written;
    const index = visit.entries.findIndex(
      ({ entry }) => entry.id === written.id
    );
    // Stryker disable next-line ConditionalExpression: an entry once written stays; the check is for the type
    if (index < 0) return;
    const last = written.measured;
    // A read of the page it went on to, as when its typing submitted a
    // form, has nothing of its own Visit: what it showed up to the last
    // read of its page stays.
    const after =
      placeIn(visit, interaction.after) < 0 &&
      last &&
      placeIn(visit, last.after) >= 0
        ? last.after
        : interaction.after;
    const end = placeIn(visit, after);
    const sameAfter = last?.after === after;
    // Nothing new, as a fill's final write after its last update: the list
    // stays the one told.
    if (sameAfter && sameReport(last!.report, interaction.report)) return;
    // A new text alone, as with each key, is not measured again.
    const measured = sameAfter
      ? last!.as
      : await this.measure(written, visit.snapshots[end]);
    written.measured = {
      after,
      as: measured,
      report: interaction.report,
    };
    if (after) this.endingAt.set(after, { written, interaction });
    visit.entries[index] = this.entryOf(
      written,
      interaction,
      measured,
      visit.entries[index]!.entry.discarded
    );
    // Where the entries stand is worked out again from where they stood
    // before it: an "after" on another Visit leaves them there. An entry
    // written after it keeps them where they are.
    visit.through =
      index === visit.entries.length - 1
        ? Math.max(written.throughAtStart, end)
        : Math.max(visit.through, end);
    const place = this.recorded.findIndex((one) => one.id === written.id);
    this.recorded[place] = {
      ...this.recorded[place]!,
      after,
      afterInVisit: end < 0 ? null : after,
    };
    this.tell();
  }

  /** Replaces only the text of an entry added under a key. */
  private retext(written: Written, report: InteractionReport) {
    const { visit } = written;
    const index = visit.entries.findIndex(
      ({ entry }) => entry.id === written.id
    );
    const kept = visit.entries[index];
    // Stryker disable next-line ConditionalExpression: an entry added under a key is an Interaction's; the check is for the type
    if (kept?.entry.kind !== "interaction") return;
    visit.entries[index] = {
      ...kept,
      entry: {
        ...kept.entry,
        interaction: interactionDetails(
          written.id,
          report,
          written.target ?? null
        ),
      },
    };
    this.tell();
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
   * its target, with `row` the element that row of its changes names; each
   * by the ref the page's latest snapshot gives it, so that exactly that
   * element lights up. When that snapshot no longer lists it, a target is
   * found by the selector Playwright recorded, a row's element by the
   * selector of its label: every element either matches lights up. Only a
   * ref the browser gave can name an element of the page: core makes up
   * refs for the nodes the browser gave none. An entry of a Visit its page
   * has left is found by those selectors, as no ref of that Visit names an
   * element of the page's new document. Null for a target with neither,
   * and a row the entry does not have or whose element is named by nothing.
   */
  liveTarget(
    entry: EntryId,
    row?: number
  ): { readonly page: PageId; readonly find: ElementLookup } | null {
    for (const visit of this.all) {
      const found = visit.entries.find((one) => one.entry.id === entry);
      if (!found) continue;
      const left = this.current.get(visit.page) !== visit;
      const find =
        row === undefined
          ? targetLookupOf(visit, found, left)
          : lookupOf(visit, found.rows[row], left);
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

  /** What changed on the page from one kept snapshot to a later one. Each
   * may stand as `fromTree` and `toTree` say instead, under its own refs. */
  private change(
    from: Kept,
    to: Kept,
    fromTree = from.tree,
    toTree = to.tree
  ): Promise<StructuralTree> {
    return this.reconciled(
      from,
      fromTree,
      toTree,
      new Map([...from.firstRefs, ...to.firstRefs])
    );
  }

  /** What changed on `from`'s page from one tree to another, under the
   * elements' first refs, with the way to the page before it kept beside it:
   * a removed element is named by its place there. */
  private async reconciled(
    from: Kept,
    fromTree: StructuralTree,
    toTree: StructuralTree,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>
  ): Promise<StructuralTree> {
    const change = await this.session.readIdentityLedger(
      from.observation.pageId,
      (ledger) =>
        StructuralTree.reconcile(fromTree, toTree, {
          sameIdentity: (beforeRef: AriaRef, afterRef: AriaRef) =>
            ledger.sameIdentity(beforeRef, afterRef),
        })
    );
    return withPageBefore(this.underFirstRefs(change, firstRefs), () =>
      this.underFirstRefs(fromTree, firstRefs)
    );
  }

  /**
   * The read before a held click as the page stood just before its press:
   * the press reaches the page before the gate holds the click, so the read
   * shows the focus it moved. When the element the press focused is the
   * one clicked, or one around it, the focus stands where the read before
   * had it, so that the move is the click's own change. Null when the press
   * moved no focus.
   */
  private beforeItsPress(
    previous: Kept,
    before: Kept,
    report: InteractionReport
  ): StructuralTree | null {
    if (!PRESSED.has(report.type)) return null;
    const target = locateTarget(before.tree, report);
    const focused = (tree: StructuralTree) => {
      let found: StructuralNode | undefined;
      tree.walk((node) => {
        if (node.state.active) found ??= node;
      });
      return found;
    };
    const now = focused(before.tree);
    if (!target || !now) return null;
    const pressedOn =
      now.ref === target ||
      before.tree.getAncestorsOf(target).some((node) => node.ref === now.ref);
    if (!pressedOn) return null;
    const firstOf = (kept: Kept, ref: AriaRef) =>
      kept.firstRefs.get(snapshotRef(ref));
    const was = focused(previous.tree);
    const wasFirst = was && firstOf(previous, was.ref);
    // It had the focus already: the press moved none.
    if (wasFirst && wasFirst === firstOf(before, now.ref)) return null;
    const rename = (node: StructuralNode): StructuralNode => {
      const active =
        node.ref === now.ref
          ? false
          : wasFirst !== undefined && firstOf(before, node.ref) === wasFirst
            ? true
            : node.state.active;
      // A read writes no focus as none: so does this.
      const state = { ...node.state };
      delete state.active;
      return node.copy({
        state: active ? { ...state, active } : state,
        children: node.children.map((child) =>
          typeof child === "string" ? child : rename(child)
        ),
      });
    };
    return new StructuralTree(rename(before.tree.root), this.refs);
  }

  /**
   * Matches an input's picture with its "before" and its "after", or with
   * its "before" alone while it has no "after", and writes what had changed
   * by the moment of the input as a change of its own, ahead of it. A
   * picture that cannot be read so is warned of, and the input is taken as
   * one the gate held.
   */
  private async pictured(
    visit: Visit,
    interaction: Waiting,
    from: Kept,
    to: Kept | undefined
  ): Promise<{ pictured: Pictured | null; changedBefore: EntryId | null }> {
    const { target, type, selector } = interaction.report;
    const picture =
      target &&
      pictureBefore({
        previous: from.tree,
        ...(to && {
          between: await this.session.readChange(
            from.observation.pageId,
            from.observation,
            to.observation
          ),
        }),
        picture: target.tree,
        selector,
        target: target.ref,
        targetAsBefore: type === "fill" || type === "select",
        refs: this.refs,
      });
    if (!picture) {
      this.warned.push({
        kind: "reportShape",
        message: `Playwright's report of ${interaction.id} does not have the shape of a snapshot: it is recorded with what it changed up to its 'after' only.`,
      });
      return { pictured: null, changedBefore: null };
    }
    const pictured = { picture, tied: new Map<AriaRef, AriaRef>() };
    const before = await this.changedBefore(
      from,
      pictured,
      new Map([...from.firstRefs, ...(to?.firstRefs ?? [])])
    );
    return {
      pictured,
      changedBefore: changedSomething(before)
        ? this.writeChange(visit, interaction.at, before)
        : null,
    };
  }

  /** What had changed from the "before" to the picture. */
  private async changedBefore(
    from: Kept,
    pictured: Pictured,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>
  ): Promise<StructuralTree> {
    return this.reconciled(from, from.tree, this.tiedTree(pictured), firstRefs);
  }

  /** The picture's tree, each element tied to a later read under that
   * read's ref. */
  private tiedTree({ picture, tied }: Pictured): StructuralTree {
    if (tied.size === 0) return picture.tree;
    const rename = (node: StructuralNode): StructuralNode =>
      node.copy({
        ref: tied.get(node.ref) ?? node.ref,
        children: node.children.map((child) =>
          typeof child === "string" ? child : rename(child)
        ),
      });
    return new StructuralTree(rename(picture.tree.root), this.refs);
  }

  /**
   * Ties each element of the picture that its "before" has not to the ref
   * the read `to` gives it, as the picture matched with both reads says.
   * The change of its own ahead of the input then names it as the later
   * trees do. It keeps its place and id; its rows can change with what the
   * later read tells, as a group that turns out to be named.
   */
  private async tie(written: Written, to: Kept) {
    const { from, pictured, first, visit } = written;
    // Stryker disable next-line OptionalChaining: only an input with a picture is tied; the check is for the type
    const target = first.report.target;
    if (!pictured || !target) return;
    // Every element the "before" lacks is tied already.
    if ([...pictured.picture.fresh].every((ref) => pictured.tied.has(ref)))
      return;
    const later = pictureBefore({
      previous: from.tree,
      between: await this.session.readChange(
        from.observation.pageId,
        from.observation,
        to.observation
      ),
      picture: target.tree,
      selector: first.report.selector,
      target: target.ref,
      targetAsBefore:
        first.report.type === "fill" || first.report.type === "select",
      // Its own refs are only looked at, never kept.
      refs: new SyntheticAriaRefFactory(),
    });
    if (!later) return;
    let tiedNow = false;
    for (const [seen, ref] of pictured.picture.refOf) {
      if (!pictured.picture.fresh.has(ref) || pictured.tied.has(ref)) continue;
      const now = later.refOf.get(seen);
      if (now === undefined || later.fresh.has(now) || !to.tree.getNode(now))
        continue;
      pictured.tied.set(ref, now);
      tiedNow = true;
    }
    if (!tiedNow || !written.changedBefore) return;
    const index = visit.entries.findIndex(
      ({ entry }) => entry.id === written.changedBefore
    );
    const kept = visit.entries[index]!;
    const before = await this.changedBefore(
      from,
      pictured,
      new Map([...from.firstRefs, ...to.firstRefs])
    );
    const { changes, rows } = rowsOf(before);
    visit.entries[index] = {
      ...kept,
      entry: { ...kept.entry, kind: "change", changes },
      change: before,
      rows,
    };
  }

  /**
   * An Interaction's target and what it changed, from its "before", or from
   * its picture, to its "after"; nothing when it has no "after" in its
   * Visit.
   */
  private async measure(
    written: Written,
    to: Kept | undefined,
    toTree = to && (this.beforePress.get(to.snapshot.id) ?? to.tree)
  ): Promise<Measured> {
    const { from, pictured } = written;
    if (!pictured) return this.measureHeld(written, to, toTree);
    if (to) await this.tie(written, to);
    const tree = this.tiedTree(pictured);
    const firstRefs = new Map([...from.firstRefs, ...(to?.firstRefs ?? [])]);
    const firstOf = (ref: AriaRef) =>
      firstRefs.get(snapshotRef(ref)) ??
      written.visit.firstRefs.get(snapshotRef(ref)) ??
      firstRef(snapshotRef(ref));
    const ref = pictured.picture.target;
    const targetRef = ref && (pictured.tied.get(ref) ?? ref);
    const measured = {
      target: targetRef && firstOf(targetRef),
      named: namedTarget(tree, targetRef),
    };
    if (!to) return { ...measured, change: null };
    return {
      ...measured,
      change: await this.reconciled(from, tree, toTree ?? to.tree, firstRefs),
    };
  }

  /** An Interaction the gate held, or one with no picture, from its
   * "before" to its "after". */
  private async measureHeld(
    written: Written,
    to: Kept | undefined,
    toTree: StructuralTree | undefined
  ): Promise<Measured> {
    const { from, first } = written;
    // The read its target is found in: its own, for an assertion placed at
    // an earlier one.
    const read =
      written.visit.snapshots.find(
        (kept) => kept.snapshot.id === first.targetRead
      ) ?? from;
    const located = locateTarget(read.tree, first.report);
    const pressed = this.beforePress.get(from.snapshot.id);
    return {
      // Every ref of a kept snapshot has its first ref.
      target: located && read.firstRefs.get(located),
      named: namedTarget(read.tree, located),
      change: to
        ? await this.change(from, to, pressed ?? from.tree, toTree)
        : null,
    };
  }

  /** An Interaction's entry as measured. */
  private entryOf(
    written: Written,
    interaction: RecordedInteraction,
    { target, named, change }: Measured,
    discarded?: true
  ): Entry {
    written.target = target;
    written.named = named;
    const changed = change && changedSomething(change) ? change : null;
    const told = changed && rowsOf(changed);
    return {
      entry: {
        kind: "interaction",
        id: written.id,
        timestamp: interaction.at,
        interaction: interactionDetails(
          written.id,
          interaction.report,
          target ?? null
        ),
        ...targetWords(named, interaction.report),
        ...(interaction.report.locator
          ? { targetLocator: interaction.report.locator }
          : {}),
        changes: told && told.changes,
        ...(discarded ? { discarded } : {}),
      },
      change: changed,
      rows: told ? told.rows : [],
      // A target the picture does not list is marked on an ancestor.
      ...(target && interaction.report.target?.ref === null
        ? { byAncestor: true as const }
        : {}),
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
    if (!interaction.beforeFromReport)
      await this.pressedAfter(visit, from, interaction);
    const { pictured, changedBefore } = interaction.beforeFromReport
      ? await this.pictured(visit, interaction, from, visit.snapshots[end])
      : { pictured: null, changedBefore: null };
    const written: Written = {
      visit,
      id: interaction.id,
      from,
      first: interaction,
      throughAtStart: visit.through,
      pictured,
      changedBefore,
      target: undefined,
      named: null,
    };
    const measured = await this.measure(written, visit.snapshots[end]);
    written.measured = {
      after: interaction.after,
      as: measured,
      report: interaction.report,
    };
    visit.entries.push(this.entryOf(written, interaction, measured));
    // The entries never go back: an Interaction with no "after" here, or
    // one written late, leaves them where they stand.
    visit.through = Math.max(visit.through, end);
    if (interaction.key !== undefined) this.byKey.set(interaction.key, written);
    if (interaction.after)
      this.endingAt.set(interaction.after, { written, interaction });
  }

  /**
   * A held click that starts where the Interaction before it ends, as a
   * click right after typing: the read between them shows the focus its
   * press moved. That read stands with the focus where the read before it
   * had it, and the Interaction before is measured to it again: the move is
   * the click's, and the Interaction before keeps what it did itself.
   */
  private async pressedAfter(
    visit: Visit,
    from: Kept,
    click: RecordedInteraction
  ) {
    const id = from.snapshot.id;
    // A step of its own before it took the read as it stood already.
    if (this.beforePress.has(id) || from.resumes) return;
    const previous = visit.snapshots[placeIn(visit, id) - 1];
    const pressed =
      previous && this.beforeItsPress(previous, from, click.report);
    if (!pressed) return;
    this.beforePress.set(id, pressed);
    const ended = this.endingAt.get(id);
    if (!ended || ended.written.visit !== visit) return;
    const { written, interaction } = ended;
    const index = visit.entries.findIndex(
      ({ entry }) => entry.id === written.id
    );
    if (index < 0) return;
    const measured = await this.measure(written, from);
    written.measured = { after: id, as: measured, report: interaction.report };
    visit.entries[index] = this.entryOf(
      written,
      interaction,
      measured,
      visit.entries[index]!.entry.discarded
    );
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
    // snapshot where recording resumes is compared with nothing before it,
    // and a focus it shows may have moved while paused. Elsewhere, a focus a
    // click's press moved is the click's own change.
    const click = next.resumes
      ? undefined
      : visit.waiting.find(
          (waiting) =>
            waiting.before === next.snapshot.id && !waiting.beforeFromReport
        );
    const pressed = click && this.beforeItsPress(through, next, click.report);
    if (pressed) this.beforePress.set(next.snapshot.id, pressed);
    const change = next.resumes
      ? null
      : await this.change(through, next, through.tree, pressed ?? next.tree);
    // Nothing changed: there is nothing to tell.
    if (change && changedSomething(change))
      this.writeChange(visit, next.snapshot.at, change);
    visit.through += 1;
    return true;
  }

  /** Writes a change of its own: one no Interaction explains. */
  private writeChange(
    visit: Visit,
    at: number,
    change: StructuralTree
  ): EntryId {
    const id = `change_${++this.changes}` as EntryId;
    const { changes, rows } = rowsOf(change);
    visit.entries.push({
      entry: { kind: "change", id, timestamp: at, changes },
      change,
      rows,
    });
    return id;
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
