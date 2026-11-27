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

/** A read of a page, in its place among its Visit's. */
type Read = {
  readonly snapshot: PageSnapshot;
  /** Recording resumes here after a pause: what changed from the snapshot
   * before it is not the recording's. */
  readonly resumes: boolean;
};

/** A snapshot as the timeline keeps it. */
type Kept = Read & {
  readonly observation: StructuralObservationEntry;
  /** The tree as the browser named it. */
  readonly tree: StructuralTree;
  /** From each ref the browser used here to the first ref its element had. */
  readonly firstRefs: ReadonlyMap<SnapshotRef, FirstRef>;
  readonly lost?: undefined;
};

/**
 * A read that could not be kept, as one core's parser refuses or one with a
 * ref on two elements. It holds its place: its id, its position in the
 * trace, and the numbering of the steps around it. It has no tree, so
 * nothing is compared with it: a step that starts or ends at it has no
 * Change Tree, and a warning says so, since a package may leave out what is
 * not known and must not tell what did not happen.
 */
type Lost = Read & { readonly lost: true };

const isKept = (read: Kept | Lost): read is Kept => !read.lost;

/** A read to compare with: none for one that could not be kept. */
const comparable = (read: Kept | Lost | undefined) =>
  read && isKept(read) ? read : undefined;

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
  readonly from: Kept | Lost;
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

/** An entry that can be measured: the page was read before it. */
type Measurable = Written & { readonly from: Kept };

const measurable = (written: Written): written is Measurable =>
  isKept(written.from);

/** What an Interaction's entry is measured as. */
type Measured = {
  readonly target: FirstRef | undefined;
  readonly named: NamedElement | null;
  readonly change: StructuralTree | null;
};

/** An Interaction nothing of which can be measured: it stays in the
 * recording with what Playwright reported of it, since the person did it
 * and a test of the flow needs the step. */
const NOT_MEASURED: Measured = { target: undefined, named: null, change: null };

type Visit = {
  readonly id: string;
  /** The page it is a Visit of. */
  readonly page: PageId;
  readonly url: string;
  readonly cause: VisitCause;
  readonly snapshots: (Kept | Lost)[];
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
type Rows = {
  readonly changes: FoundRow["row"][];
  readonly rows: FoundRow["element"][];
  /** Its elements may not be under their first refs, or a re-created one
   * may show as removed and added: it could not be worked out in full. */
  readonly otherRefs: boolean;
  /** Its rows could not be named: it has none, though it has changes. */
  readonly unlisted: boolean;
};

/** The ref the Visit's latest snapshot gives an element known by its first
 * ref: none once the page has left the Visit, whose refs name nothing in
 * the document it has now, none core made up, which name no element of
 * the page, and none when that snapshot could not be kept. */
function refNow(
  visit: Visit,
  first: string | null | undefined,
  left: boolean
): ElementLookup | null {
  const latest = comparable(visit.snapshots.at(-1));
  if (left || !first || !latest) return null;
  const now = [...latest.firstRefs].find(([, kept]) => kept === first)?.[0];
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

const sameReport = (one: InteractionReport, other: InteractionReport) =>
  one === other || JSON.stringify(one) === JSON.stringify(other);

/**
 * Where a change of the page's own is, in what the package has of one: its
 * time, and the Interaction before it, or else its Visit. The package
 * writes no id for one, so a warning cannot name it by its id.
 */
function ownChangeAt(
  visit: Visit,
  at: number,
  before: readonly Entry[] = visit.entries
) {
  const interaction = before.findLast(
    ({ entry }) => entry.kind === "interaction"
  );
  return `at ${at} ${interaction ? `after ${interaction.entry.id}` : `in ${visit.id}`}`;
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
  /** The rows of each Change Tree, named once as it is made: the page
   * before it, and the indexes its labels are worked out with, are needed
   * only then. */
  private readonly named = new WeakMap<StructuralTree, Rows>();

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

  /** A read of a page, kept in the Visit of the document it is of: the
   * latest Visit of its page at the address it was read at. */
  private async keepRead(
    addition: Extract<TimelineAddition, { kind: "snapshot" }>
  ) {
    this.readAt.set(addition.snapshot.id, addition.snapshot.at);
    const { page, url } = addition.snapshot;
    // A read of a document the page has left, as one a navigation overtook,
    // is of the Visit it left, never of where the page went, so that what
    // starts from it is kept there; one of the blank page is of no Visit.
    // A document is known by its address alone: a read the page left, came
    // back to its address and left again during is taken for the later Visit.
    const visit = this.all.findLast(
      (started) => started.page === page && sameDocument(started.url, url)
    );
    if (!visit) return;
    const resumes = addition.resumes === true;
    visit.snapshots.push(
      await this.keep(visit, addition.snapshot).then(
        (read): Kept => ({ ...read, resumes }),
        // It holds its place, as `Lost` says. Of a read its record of the
        // elements refuses, core's session still has the observation, which
        // it takes before that record sees it: the record skips it, and
        // matches the next read with the last one it took.
        (): Lost => ({ snapshot: addition.snapshot, resumes, lost: true })
      )
    );
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
    this.warnOfReads(visit, recorded.id, interaction);
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
    const keptAt = (snapshot: SnapshotId | null) =>
      comparable(visit.snapshots[placeIn(visit, snapshot)]) !== undefined;
    // A read of the page it went on to, as when its typing submitted a
    // form, has nothing of its own Visit, and a read that could not be kept
    // shows nothing: what it showed up to the last kept read of its page
    // stays.
    const after =
      !keptAt(interaction.after) && last && keptAt(last.after)
        ? last.after
        : interaction.after;
    const end = placeIn(visit, after);
    this.warnOfReads(visit, written.id, interaction);
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
    // The trace holds the page of its latest read in its Visit, also of
    // one that could not be kept.
    const traced =
      placeIn(visit, interaction.after) < 0 ? after : interaction.after;
    this.recorded[place] = {
      ...this.recorded[place]!,
      after: traced,
      afterInVisit: placeIn(visit, traced) < 0 ? null : traced,
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
    };
  }

  /** Warns, once, of a read an Interaction starts at, ends at or picked
   * its element in that could not be kept: the package does not mark the
   * step. */
  private warnOfReads(
    visit: Visit,
    id: EntryId,
    { before, after, targetRead }: RecordedInteraction
  ) {
    const lost = (snapshot: SnapshotId | null) =>
      visit.snapshots[placeIn(visit, snapshot)]?.lost;
    if (lost(before))
      this.warn(
        "pageNotRead",
        `The page could not be read before ${id}, so its target is known by its selector only and it has no change list.`
      );
    if (lost(after))
      this.warn(
        "pageNotRead",
        `The page could not be read after ${id}, so its change list is missing, or stops at the last read before that.`
      );
    if (lost(targetRead ?? null))
      this.warn(
        "pageNotRead",
        `The page could not be read where ${id} picked its element, so its target is known by its selector only.`
      );
  }

  /**
   * Warns of the reads of a Visit that could not be kept and that no
   * Interaction starts or ends at, when the package is made: only then is
   * it known where the trace holds each.
   */
  private warnOfLostReads(
    visit: Visit,
    start: number,
    positions: Readonly<Record<SnapshotId, TracePosition>>
  ) {
    const ends = new Set(
      this.recorded.flatMap(({ before, after }) => [before, after])
    );
    visit.snapshots.forEach((read, place) => {
      if (!read.lost) return;
      const position = positions[read.snapshot.id];
      const where =
        `at ${read.snapshot.at}` +
        (position === undefined ? "" : ` (trace position ${position})`);
      if (place === start)
        this.warn(
          "pageNotRead",
          `The page could not be read where ${visit.id} starts in the recording, ${where}: its baselineTree is the last read of the page before that, or empty when there was none.`
        );
      else if (!ends.has(read.snapshot.id))
        this.warn(
          "pageNotRead",
          `A read of the page in ${visit.id}, ${where}, could not be kept: whether the page changed by itself around it is not known.`
        );
    });
  }

  /** Keeps a warning, unless it is kept already: an entry measured again
   * falls short the same way again. */
  private warn(kind: RecorderWarning["kind"], message: string) {
    if (!this.warned.some((one) => one.message === message))
      this.warned.push({ kind, message });
  }

  /**
   * A tree with each element under its first ref, and no ref twice: one ref
   * names one element in a tree. A tree of what changed between two
   * snapshots can hold an element that stood under another's first ref in
   * the earlier one beside that other, as when the page re-created an
   * element and the original is back. The element that first had the ref
   * keeps it there, and the other is written under its own, or under a new
   * one when another element of the tree has its own as a first ref, as
   * when the page re-created it in turn. How each node of a Change Tree
   * stood before goes with it, under its new ref.
   *
   * `given` holds the ref each element of a tree renamed earlier through it
   * was given, by its own ref, and gets this tree's. An element that tree
   * had keeps the ref it was given there: the page before a change names a
   * removed element under its ref in the Change Tree, which can differ from
   * the one it would hold among that page's elements alone.
   */
  private underFirstRefs(
    tree: StructuralTree,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>,
    given = new Map<SnapshotRef, AriaRef>()
  ): StructuralTree {
    // A ref no earlier snapshot of the Visit had is the element's first.
    const first = (ref: SnapshotRef) => firstRefs.get(ref) ?? firstRef(ref);
    const owns = tree.getAllRefs().map(snapshotRef);
    // The first to claim a ref holds it, unless the element whose own ref it
    // is comes after: that one first had it, and takes it.
    const holder = new Map<FirstRef, SnapshotRef>();
    for (const ref of owns)
      if (!holder.has(first(ref)) || isFirst(ref, first(ref)))
        holder.set(first(ref), ref);
    // The refs this tree's elements keep from the earlier tree: another
    // element of this tree cannot have one too. Core keeps the later ref of
    // an element matched under two, so the page before can hold an element
    // the earlier tree had under another ref.
    const kept = new Set(owns.flatMap((own) => given.get(own) ?? []));
    const beforeByRef = new Map<AriaRef, StructuralNode>();
    const rename = (node: StructuralNode): StructuralNode => {
      const own = snapshotRef(node.ref);
      // One that does not hold its first ref keeps its own from here on.
      const chosen =
        holder.get(first(own)) === own ? first(own) : firstRef(own);
      const free = !kept.has(chosen) && (holder.get(chosen) ?? own) === own;
      const ref = given.get(own) ?? (free ? chosen : this.refs.create());
      given.set(own, ref);
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

  /**
   * What changed on `from`'s page from one tree to another, under the
   * elements' first refs, with its rows: a removed element is named by its
   * place in the page before it, built only to name one.
   *
   * It is worked out in three stages, and each has a fallback, so that a
   * page shape a stage does not know costs a step some detail and not the
   * recording; https://github.com/ayme-labs/ayme/issues/1517 is to leave
   * the fallbacks nothing to catch. It fails only when core can compare the
   * two trees in neither way.
   */
  private async reconciled(
    from: Kept,
    fromTree: StructuralTree,
    toTree: StructuralTree,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>
  ): Promise<StructuralTree> {
    let exact = true;
    const change = await this.session
      .readIdentityLedger(from.observation.pageId, (ledger) =>
        StructuralTree.reconcile(fromTree, toTree, {
          sameIdentity: (beforeRef: AriaRef, afterRef: AriaRef) =>
            ledger.sameIdentity(beforeRef, afterRef),
        })
      )
      .catch(() => {
        exact = false;
        // Compared again with only an element under one ref in both trees
        // taken for the same one: core never asks about such a pair, and
        // its default answer would take any two that look alike for one.
        // Core's record of the elements is neither read nor written.
        return StructuralTree.reconcile(fromTree, toTree, {
          // Stryker disable next-line ArrowFunction: equivalent, since core takes no answer for "not the same"
          sameIdentity: () => false,
        });
      });
    // A removed element is looked up on the page before by its ref in the
    // Change Tree: both are named under the same refs.
    const given = new Map<SnapshotRef, AriaRef>();
    const renamed = this.renamed(change, firstRefs, given);
    // Core's own tree, under the refs the page gave, when it cannot be
    // renamed: the page before is then asked under those refs too.
    const tree = renamed ?? change;
    let found: FoundRow[] | null = null;
    try {
      found = foundRows(tree, () =>
        renamed ? this.underFirstRefs(fromTree, firstRefs, given) : fromTree
      );
    } catch {
      // The tree stays, so the package is the same: only the rows whoever
      // shows the recorder lists are missing.
    }
    this.named.set(tree, {
      changes: found?.map(({ row }) => row) ?? [],
      rows: found?.map(({ element }) => element) ?? [],
      otherRefs: !exact || !renamed,
      unlisted: !found,
    });
    return tree;
  }

  /** A tree under its elements' first refs (`underFirstRefs`); null when
   * that fails, or leaves one ref on two elements, which no reader of a
   * tree expects. */
  private renamed(
    tree: StructuralTree,
    firstRefs: ReadonlyMap<SnapshotRef, FirstRef>,
    given?: Map<SnapshotRef, AriaRef>
  ): StructuralTree | null {
    try {
      const renamed = this.underFirstRefs(tree, firstRefs, given);
      if (renamed.findDuplicateRef() === null) return renamed;
    } catch {
      // A tree that cannot be renamed is none, like one with a ref twice.
    }
    return null;
  }

  /** Warns of how an entry's Change Tree falls short, naming the entry by
   * what the package has of it (`subject`): the package does not mark it. */
  private warnOfShortfall(subject: string, { otherRefs, unlisted }: Rows) {
    if (otherRefs)
      this.warn(
        "changesNotWorkedOut",
        `${subject} could not be fully worked out. An element the page re-created may be listed under another ref, or as removed and added.`
      );
    if (unlisted)
      this.warn(
        "changesNotWorkedOut",
        `${subject} cannot be listed in the recorder window. The recording package is not affected.`
      );
  }

  /** What an Interaction changed, or nothing, with a warning, when the two
   * pages cannot be compared at all: it keeps its target. */
  private changeOf(
    id: EntryId,
    change: Promise<StructuralTree>
  ): Promise<StructuralTree | null> {
    return change.catch(() => {
      this.warnOfNoChangeList(id);
      return null;
    });
  }

  private warnOfNoChangeList(id: EntryId) {
    this.warn(
      "changesNotWorkedOut",
      `The changes of ${id} could not be worked out, so it has no change list.`
    );
  }

  /** Not measured, and warned of: something broke while it was. */
  private unmeasured(id: EntryId): Measured {
    this.warnOfNoChangeList(id);
    return NOT_MEASURED;
  }

  /** The rows of a Change Tree as an entry tells them, and their elements,
   * as it was named when it was made. */
  private rowsOf(change: StructuralTree): Rows {
    return this.named.get(change)!;
  }

  /**
   * The read before a held click as the page stood just before its press:
   * the press reaches the page before the gate holds the click, so the read
   * shows the focus it moved. When the element the press focused is the
   * one clicked, or one around it, the focus stands where the read before
   * had it, so that the move is the click's own change. Null when the press
   * moved no focus.
   *
   * A page's first click can leave out the focus its press moved: the page
   * is first read for that click, after the press, and no read shows where
   * the focus was before. Telling it would take the gate noting
   * the focused element at the press, a datum the adapter and the lifecycle
   * would carry.
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
  private async tie(written: Measurable, to: Kept) {
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
    const ahead = visit.entries[index]!;
    const before = await this.changedBefore(
      from,
      pictured,
      new Map([...from.firstRefs, ...to.firstRefs])
    );
    const told = this.rowsOf(before);
    const { changes, rows } = told;
    this.warnOfShortfall(
      `The page's own change ${ownChangeAt(visit, written.first.at, visit.entries.slice(0, index))}`,
      told
    );
    visit.entries[index] = {
      ...ahead,
      entry: { ...ahead.entry, kind: "change", changes },
      change: before,
      rows,
    };
  }

  /** An Interaction measured (`measureExactly`), or, whatever breaks
   * there, not measured, so that it stays in the recording each time it is
   * measured: when it is written, and again with each key of its typing. */
  private async measure(
    written: Written,
    to: Kept | Lost | undefined
  ): Promise<Measured> {
    // The page was not read before it: the warning of that read says so.
    if (!measurable(written)) return NOT_MEASURED;
    // A read after it that could not be kept is no "after" to measure to.
    return this.measureExactly(written, comparable(to)).catch(() =>
      this.unmeasured(written.id)
    );
  }

  /**
   * An Interaction's target and what it changed, from its "before", or from
   * its picture, to its "after"; nothing when it has no "after" in its
   * Visit.
   */
  private async measureExactly(
    written: Measurable,
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
      change: await this.changeOf(
        written.id,
        this.reconciled(from, tree, toTree ?? to.tree, firstRefs)
      ),
    };
  }

  /** An Interaction the gate held, or one with no picture, from its
   * "before" to its "after". */
  private async measureHeld(
    written: Measurable,
    to: Kept | undefined,
    toTree: StructuralTree | undefined
  ): Promise<Measured> {
    const { from, first } = written;
    // The read its target is found in: its own, for an assertion placed at
    // an earlier one.
    const read =
      written.visit.snapshots.find(
        (one) => one.snapshot.id === first.targetRead
      ) ?? from;
    // A read that could not be kept shows no element, and a ref the page
    // gave there may name another element in the read before: its selector
    // alone names the target then.
    const located = isKept(read)
      ? locateTarget(read.tree, first.report)
      : undefined;
    const pressed = this.beforePress.get(from.snapshot.id);
    return {
      // Every ref of a kept snapshot has its first ref.
      target: located && comparable(read)!.firstRefs.get(located),
      named: isKept(read) ? namedTarget(read.tree, located) : null,
      change: to
        ? await this.changeOf(
            written.id,
            this.change(from, to, pressed ?? from.tree, toTree)
          )
        : null,
    };
  }

  private entryOf(
    written: Written,
    interaction: RecordedInteraction,
    { target, named, change }: Measured,
    discarded?: true
  ): Entry {
    written.target = target;
    written.named = named;
    const changed = change && changedSomething(change) ? change : null;
    const told = changed && this.rowsOf(changed);
    if (told) this.warnOfShortfall(`The changes of ${written.id}`, told);
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
    // As the gate held it, which it is also taken for when what comes
    // ahead of measuring it breaks, as reading its picture.
    const held: Written = {
      visit,
      id: interaction.id,
      from,
      first: interaction,
      throughAtStart: visit.through,
      pictured: null,
      changedBefore: null,
      target: undefined,
      named: null,
    };
    const [written, measured] = await this.measuredFirst(
      interaction,
      held,
      end
    ).catch((): [Written, Measured] => [held, this.unmeasured(held.id)]);
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

  /** An Interaction's entry as it starts, with its picture if it has one,
   * and what it is first measured as. */
  private async measuredFirst(
    interaction: Waiting,
    held: Written,
    end: number
  ): Promise<[Written, Measured]> {
    // The page was not read before it: the warning of that read says so.
    if (!measurable(held)) return [held, NOT_MEASURED];
    const { visit, from } = held;
    // A read after it that could not be kept is no "after" either.
    const to = comparable(visit.snapshots[end]);
    if (!interaction.beforeFromReport)
      await this.pressedAfter(visit, from, interaction);
    const written = interaction.beforeFromReport
      ? { ...held, ...(await this.pictured(visit, interaction, from, to)) }
      : held;
    return [written, await this.measure(written, to)];
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
    const previous = comparable(visit.snapshots[placeIn(visit, id) - 1]);
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
    // A step to or from a read that could not be kept is told nothing of,
    // and one that cannot be told is passed over with a warning, so that
    // the entries get to the Interactions after it.
    if (isKept(through) && isKept(next))
      await this.tellStep(visit, through, next).catch(() =>
        this.warn(
          "changesNotWorkedOut",
          `Whether the page changed by itself ${ownChangeAt(visit, next.snapshot.at)} could not be worked out: no such change is listed.`
        )
      );
    visit.through += 1;
    return true;
  }

  /** Writes what changed from one read to the next as a change of its
   * own, if anything did. */
  private async tellStep(visit: Visit, through: Kept, next: Kept) {
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
    if (change && changedSomething(change))
      this.writeChange(visit, next.snapshot.at, change);
  }

  /** Writes a change of its own: one no Interaction explains. */
  private writeChange(
    visit: Visit,
    at: number,
    change: StructuralTree
  ): EntryId {
    const id = `change_${++this.changes}` as EntryId;
    const told = this.rowsOf(change);
    const { changes, rows } = told;
    this.warnOfShortfall(
      `The page's own change ${ownChangeAt(visit, at)}`,
      told
    );
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
      await this.produce(visit);
      this.warnOfLostReads(visit, visit.start, positions);
      visits.push({
        visitId: visit.id,
        url: visit.url,
        cause: visit.cause,
        entries: visit.entries,
        baselineTree: this.firstTree(visit, visit.start),
      });
    }
    return renderPackage(header, visits, this.tracePoints(positions));
  }

  /**
   * A Visit's first tree as the package writes it: the page at the read
   * the Visit starts at, or at the last one kept before that when it could
   * not be kept, which the warning of that read says; empty with none. It
   * is under its elements' first refs, or under the refs the page gave,
   * with a warning, when it cannot be renamed.
   */
  private firstTree(visit: Visit, start: number): string {
    const first = visit.snapshots.slice(0, start + 1).findLast(isKept);
    if (!first) return "";
    const renamed = this.renamed(first.tree, first.firstRefs);
    if (!renamed)
      this.warn(
        "changesNotWorkedOut",
        `The baselineTree of ${visit.id} could not be fully worked out. An element the page re-created before its first step may be listed under another ref.`
      );
    return wholeTreeText(renamed ?? first.tree);
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
