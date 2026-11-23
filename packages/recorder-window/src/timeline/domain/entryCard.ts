import type {
  RecorderCommand,
  RecorderCommandType,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";

import { shownRows, type PlacedRow } from "./changeGroups";
import {
  changeTitle,
  chipText,
  effectOf,
  groupEffect,
  groupText,
} from "./changeWording";
import { interactionTitle } from "./entryText";

/** The kinds of entry the window has an icon for. */
export type EntryIcon =
  "click" | "press" | "fill" | "assertVisible" | "interaction" | "change";

/** An element as a chip shows it. */
export type Chip = {
  readonly text: string;
  /** Shown on hover: the target's selector, when the chip names it. */
  readonly hint?: string;
  /** What hovering it asks: a highlight of its element on the page, while
   * that applies, whichever Visit it is of; none otherwise. */
  readonly highlight: RecorderCommand | null;
};

/** A row of what an entry changed: an element's chip, and what happened
 * to it. */
export type ChangeLine = { readonly chip: Chip; readonly effect: string };

/** A row as the window lists it: one element's, or one that folds elements
 * of one role (`folded`), listed when it is expanded. A folded row's chip
 * highlights nothing; each row it folds highlights its own element. */
export type ChangeItem = ChangeLine & {
  readonly folded?: readonly ChangeLine[];
};

/** One entry as the window shows it. */
export type EntryCard = {
  readonly icon: EntryIcon;
  readonly title: string;
  /** The Interaction's target; none on a change no Interaction made, and
   * none for a target known neither by element nor by selector. */
  readonly target: Chip | null;
  /** What leaving a chip asks: no highlight. None while highlighting does
   * not apply. */
  readonly leave: RecorderCommand | null;
  /** The person left it out: it stays where it is, struck through. */
  readonly discarded: boolean;
  /** Discard, when it applies now to an entry that is kept. */
  readonly discard: RecorderCommand | null;
  /** Restore, when it applies now to an entry that is discarded. */
  readonly restore: RecorderCommand | null;
  /** The roots of what it changed, folded as the window lists them
   * (`shownRows`); none shown while it is discarded. */
  readonly changes: readonly ChangeItem[];
};

const ICONS: Partial<Record<string, EntryIcon>> = {
  click: "click",
  press: "press",
  fill: "fill",
  assertVisible: "assertVisible",
};

/** The target's chip: its element in the page structure's words, or
 * "element" when the engine gives none, never a raw selector; with its
 * selector on hover, in Playwright's own words when the engine has them. */
function targetOf(
  entry: Extract<TimelineEntry, { kind: "interaction" }>,
  highlight: RecorderCommand | null
): Chip | null {
  const { targetSelector: selector, targetRef } = entry.interaction;
  const hint = entry.targetLocator ?? selector;
  if (entry.targetElement)
    return {
      text: chipText(entry.targetElement),
      ...(hint ? { hint } : {}),
      highlight,
    };
  // With no words for it, it has no wording of Playwright's either.
  if (selector) return { text: "element", hint: selector, highlight };
  return targetRef ? { text: `[ref=${targetRef}]`, highlight } : null;
}

/** The entry's icon and title: an Interaction's kind, or a change's. */
function headingOf(entry: TimelineEntry): Pick<EntryCard, "icon" | "title"> {
  if (entry.kind !== "interaction")
    return { icon: "change", title: changeTitle(entry.changes) };
  const { interaction } = entry;
  return {
    icon: ICONS[interaction.type] ?? "interaction",
    title: interactionTitle(interaction),
  };
}

/** What reviewing the entry offers now: Discard while it is kept, Restore
 * while it is discarded, each when it applies. */
function reviewOf(
  entry: TimelineEntry,
  applies: (type: RecorderCommandType) => boolean
): Pick<EntryCard, "discarded" | "discard" | "restore"> {
  const discarded = entry.discarded === true;
  const offer = (type: "discard" | "restore", when: boolean) =>
    when && applies(type) ? { type, entry: entry.id } : null;
  return {
    discarded,
    discard: offer("discard", !discarded),
    restore: offer("restore", discarded),
  };
}

/** Whether the window lists an entry: every Interaction, and a change no
 * Interaction made while it has a row to show. */
export const entryShows = (entry: TimelineEntry): boolean =>
  entry.kind !== "change" || shownRows(entry.changes).length > 0;

/**
 * Reads how an entry shows from the entry and the commands that apply. The
 * chips of every Visit can highlight their elements: the engine looks for an
 * element of a Visit its page has left on the page as it is now.
 */
export function entryCardOf(
  entry: TimelineEntry,
  commands: readonly RecorderCommandType[]
): EntryCard {
  const applies = (type: RecorderCommandType) => commands.includes(type);
  const highlights = applies("highlight");
  const highlight = (row?: number): RecorderCommand | null =>
    highlights
      ? {
          type: "highlight",
          entry: entry.id,
          ...(row === undefined ? {} : { row }),
        }
      : null;
  const review = reviewOf(entry, applies);
  // A row highlights its element by its place among the entry's rows.
  const line = ({ row, index }: PlacedRow): ChangeLine => ({
    chip: { text: chipText(row.element), highlight: highlight(index) },
    effect: effectOf(row),
  });
  return {
    ...headingOf(entry),
    target: entry.kind === "interaction" ? targetOf(entry, highlight()) : null,
    leave: applies("clearHighlight") ? { type: "clearHighlight" } : null,
    ...review,
    changes: review.discarded
      ? []
      : shownRows(entry.changes ?? []).map((shown) =>
          "rows" in shown
            ? {
                chip: {
                  text: groupText(shown.role, shown.rows.length),
                  highlight: null,
                },
                effect: groupEffect(
                  shown.rows.map(({ row }) => row),
                  shown.parent
                ),
                folded: shown.rows.map(line),
              }
            : line(shown)
        ),
  };
}
