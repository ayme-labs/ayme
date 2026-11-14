import type {
  RecorderCommand,
  RecorderCommandType,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";

import { changeRoots, type ChangeRoot } from "./changeRoots";
import { interactionTitle, targetLabel } from "./entryText";

/** The kinds of entry the window has an icon for. */
export type EntryIcon =
  "click" | "press" | "fill" | "assertVisible" | "interaction" | "change";

/** One entry as the window shows it. */
export type EntryCard = {
  readonly icon: EntryIcon;
  readonly title: string;
  /** The Interaction's target in the page structure's words; none on a
   * change no Interaction made. */
  readonly target: string | null;
  /** The person left it out: it stays where it is, dimmed. */
  readonly discarded: boolean;
  /** Discard, or Restore for a discarded entry, when it applies now. */
  readonly review: {
    readonly label: "Discard" | "Restore";
    readonly command: RecorderCommand;
  } | null;
  /** What hovering the target asks, as each applies now: a highlight of
   * its element on entering, and clearing it on leaving. */
  readonly hover: {
    readonly enter: RecorderCommand | null;
    readonly leave: RecorderCommand | null;
  };
  /** The roots of what it changed; none shown while it is discarded. */
  readonly changes: readonly { element: string; effect: string }[];
};

const ICONS: Partial<Record<string, EntryIcon>> = {
  click: "click",
  press: "press",
  fill: "fill",
  assertVisible: "assertVisible",
};

const EFFECTS: Record<ChangeRoot["kind"], string> = {
  added: "appeared",
  removed: "was removed",
  changed: "changed",
};

/** Reads how an entry shows from the entry and the commands that apply. */
export function entryCardOf(
  entry: TimelineEntry,
  commands: readonly RecorderCommandType[]
): EntryCard {
  const applies = (type: RecorderCommandType) => commands.includes(type);
  const interaction = entry.kind === "interaction" ? entry.interaction : null;
  const discarded = entry.discarded === true;
  const review = discarded ? "restore" : "discard";
  return {
    icon: interaction ? (ICONS[interaction.type] ?? "interaction") : "change",
    title: interaction
      ? interactionTitle(interaction)
      : "Change without an Interaction",
    target: interaction && targetLabel(interaction),
    discarded,
    review: applies(review)
      ? {
          label: discarded ? "Restore" : "Discard",
          command: { type: review, entry: entry.id },
        }
      : null,
    hover: {
      enter: applies("highlight")
        ? { type: "highlight", entry: entry.id }
        : null,
      leave: applies("clearHighlight") ? { type: "clearHighlight" } : null,
    },
    changes:
      entry.changeTree && !discarded
        ? changeRoots(entry.changeTree).map((root) => ({
            element: root.element,
            effect: EFFECTS[root.kind],
          }))
        : [],
  };
}
