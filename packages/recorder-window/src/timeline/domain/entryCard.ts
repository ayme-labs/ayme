import type {
  RecorderCommand,
  RecorderCommandType,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";

import { changeTitle, chipText, effectOf } from "./changeWording";
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
   * that applies and its Visit is the page now open; none otherwise. */
  readonly highlight: RecorderCommand | null;
};

/** One entry as the window shows it. */
export type EntryCard = {
  readonly icon: EntryIcon;
  readonly title: string;
  /** The Interaction's target; none on a change no Interaction made, and
   * none for a target known neither by element nor by selector. */
  readonly target: Chip | null;
  /** What leaving a chip asks: no highlight. None while the chips are
   * inert. */
  readonly leave: RecorderCommand | null;
  /** The person left it out: it stays where it is, struck through. */
  readonly discarded: boolean;
  /** Discard, when it applies now to an entry that is kept. */
  readonly discard: RecorderCommand | null;
  /** Restore, when it applies now to an entry that is discarded. */
  readonly restore: RecorderCommand | null;
  /** The roots of what it changed; none shown while it is discarded. */
  readonly changes: readonly { chip: Chip; effect: string }[];
};

const ICONS: Partial<Record<string, EntryIcon>> = {
  click: "click",
  press: "press",
  fill: "fill",
  assertVisible: "assertVisible",
};

/** The target's chip: its element in the page structure's words, with its
 * selector on hover; the selector when the structure does not name it. */
function targetOf(
  entry: Extract<TimelineEntry, { kind: "interaction" }>,
  highlight: RecorderCommand | null
): Chip | null {
  const { targetSelector: selector, targetRef } = entry.interaction;
  if (entry.targetElement)
    return {
      text: chipText(entry.targetElement),
      ...(selector ? { hint: selector } : {}),
      highlight,
    };
  if (selector) return { text: selector, highlight };
  return targetRef ? { text: `[ref=${targetRef}]`, highlight } : null;
}

/**
 * Reads how an entry shows from the entry, the commands that apply, and
 * whether its Visit is the page now open: only the chips of that page can
 * highlight their elements.
 */
export function entryCardOf(
  entry: TimelineEntry,
  commands: readonly RecorderCommandType[],
  { current }: { readonly current: boolean }
): EntryCard {
  const applies = (type: RecorderCommandType) => commands.includes(type);
  const highlights = current && applies("highlight");
  const highlight = (row?: number): RecorderCommand | null =>
    highlights
      ? {
          type: "highlight",
          entry: entry.id,
          ...(row === undefined ? {} : { row }),
        }
      : null;
  const discarded = entry.discarded === true;
  const rows = entry.changes ?? [];
  const interaction = entry.kind === "interaction" ? entry : null;
  return {
    icon: interaction
      ? (ICONS[interaction.interaction.type] ?? "interaction")
      : "change",
    title: interaction
      ? interactionTitle(interaction.interaction)
      : changeTitle(rows),
    target: interaction && targetOf(interaction, highlight()),
    leave:
      current && applies("clearHighlight") ? { type: "clearHighlight" } : null,
    discarded,
    discard:
      !discarded && applies("discard")
        ? { type: "discard", entry: entry.id }
        : null,
    restore:
      discarded && applies("restore")
        ? { type: "restore", entry: entry.id }
        : null,
    changes: discarded
      ? []
      : rows.map((row, index) => ({
          chip: { text: chipText(row.element), highlight: highlight(index) },
          effect: effectOf(row),
        })),
  };
}
