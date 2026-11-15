import type {
  RecorderCommand,
  RecorderCommandType,
  RecordedVisit,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import {
  Eye,
  Globe,
  Keyboard,
  MousePointer2,
  RefreshCw,
  SquareMousePointer,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

import {
  entryCardOf,
  type Chip,
  type EntryCard as Card,
  type EntryIcon,
} from "../domain/entryCard";

type OnCommand = (command: RecorderCommand) => void;

const ICONS: Record<EntryIcon, LucideIcon> = {
  click: MousePointer2,
  press: Keyboard,
  fill: Type,
  assertVisible: Eye,
  interaction: SquareMousePointer,
  change: RefreshCw,
};

/** The recording as the window lists it: one section per Visit, each with
 * its entries as they are recorded. */
export function TimelineView({
  visits,
  commands,
  onCommand,
}: {
  visits: readonly RecordedVisit[];
  /** What the engine says applies now: an entry can be discarded or
   * restored, and its chips highlight their elements, when it lists those. */
  commands: readonly RecorderCommandType[];
  onCommand: OnCommand;
}) {
  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4">
      {visits.length === 0 ? (
        <p
          data-testid="timeline-empty"
          className="py-12 text-center text-muted-foreground"
        >
          No interactions recorded yet.
        </p>
      ) : (
        visits.map((visit, index) => (
          <VisitSection
            key={visit.visitId}
            visit={visit}
            number={index + 1}
            // The latest Visit is the page now open: only its chips can
            // highlight their elements.
            current={index === visits.length - 1}
            commands={commands}
            onCommand={onCommand}
          />
        ))
      )}
    </main>
  );
}

function VisitSection({
  visit,
  number,
  current,
  commands,
  onCommand,
}: {
  visit: RecordedVisit;
  number: number;
  current: boolean;
  commands: readonly RecorderCommandType[];
  onCommand: OnCommand;
}) {
  const heading = useId();
  const last = visit.entries.length - 1;
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2.5">
      <h2
        id={heading}
        className="flex items-center gap-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
      >
        Page {number}
      </h2>
      <EntryFrame Icon={Globe} line={last >= 0}>
        <p
          data-testid="visit-start"
          className="text-[13px] break-all text-muted-foreground"
        >
          {visit.cause === "openPage" ? "Opened" : "Navigated to"} {visit.url}
        </p>
      </EntryFrame>
      {visit.entries.map((entry, index) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          line={index < last}
          card={entryCardOf(entry, commands, { current })}
          onCommand={onCommand}
        />
      ))}
    </section>
  );
}

/** One entry. While paused, a quiet Discard shows on its header's right
 * when it is hovered or has focus, and a discarded entry, struck through,
 * offers to come back. How it shows is read from it (`entryCardOf`): the
 * view only lays it out. */
function EntryCard({
  entry,
  line,
  card,
  onCommand,
}: {
  entry: TimelineEntry;
  line: boolean;
  card: Card;
  onCommand: OnCommand;
}) {
  const heading = useId();
  return (
    <EntryFrame Icon={ICONS[card.icon]} line={line}>
      <article
        aria-labelledby={heading}
        data-entry={entry.id}
        data-kind={entry.kind}
        data-discarded={card.discarded}
        className="group flex flex-col"
      >
        <div className="flex min-h-6 flex-wrap items-center gap-2">
          <h3
            id={heading}
            // A change no Interaction made is titled quietly, as the
            // released window does.
            className="text-[15px] font-semibold group-data-[discarded=true]:text-muted-foreground group-data-[discarded=true]:line-through group-data-[kind=change]:text-[13px] group-data-[kind=change]:font-normal group-data-[kind=change]:text-muted-foreground"
          >
            {card.title}
          </h3>
          <ChipView
            chip={card.target}
            leave={card.leave}
            onCommand={onCommand}
            testId="entry-target"
          />
          <Discard command={card.discard} onCommand={onCommand} />
          <Restore command={card.restore} onCommand={onCommand} />
        </div>
        <Changes card={card} onCommand={onCommand} />
      </article>
    </EntryFrame>
  );
}

/** An element in a chip. Hovering it highlights its element on the page,
 * when it can; the target's selector shows on hover. */
function ChipView({
  chip,
  leave,
  onCommand,
  testId,
}: {
  chip: Chip | null;
  leave: RecorderCommand | null;
  onCommand: OnCommand;
  testId: string;
}) {
  if (!chip) return null;
  const { highlight } = chip;
  return (
    <span
      data-testid={testId}
      data-highlights={highlight !== null}
      title={chip.hint}
      onMouseEnter={() => highlight && onCommand(highlight)}
      onMouseLeave={() => leave && onCommand(leave)}
      className="rounded bg-muted px-1.5 py-0.5 text-[13px] font-semibold break-all group-data-[discarded=true]:opacity-60"
    >
      {chip.text}
    </span>
  );
}

/** A quiet Discard, seen while the entry is hovered or has focus, and
 * reached by the keyboard all the same. */
function Discard({
  command,
  onCommand,
}: {
  command: RecorderCommand | null;
  onCommand: OnCommand;
}) {
  if (!command) return null;
  return (
    <button
      type="button"
      className="ml-auto rounded px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      onClick={() => onCommand(command)}
    >
      Discard
    </button>
  );
}

/** Puts a discarded entry back. */
function Restore({
  command,
  onCommand,
}: {
  command: RecorderCommand | null;
  onCommand: OnCommand;
}) {
  if (!command) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="ml-auto size-7 text-primary"
      aria-label="Restore"
      title="Restore"
      onClick={() => onCommand(command)}
    >
      <Undo2 />
    </Button>
  );
}

/** The roots of what the entry changed: each element, and what happened to
 * it. */
function Changes({ card, onCommand }: { card: Card; onCommand: OnCommand }) {
  if (card.changes.length === 0) return null;
  return (
    <ul
      aria-label="What changed"
      className="mt-2 flex flex-col gap-1.5 border-t pt-2"
    >
      {card.changes.map((change, index) => (
        <li key={index} className="flex flex-wrap items-center gap-2">
          <ChipView
            chip={change.chip}
            leave={card.leave}
            onCommand={onCommand}
            testId="change-element"
          />
          <span
            data-testid="change-effect"
            className="text-[13px] text-muted-foreground"
          >
            {change.effect}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** An entry's place on the timeline: its icon on the left, with a line down
 * to the next entry of its Visit, and its card. */
function EntryFrame({
  Icon,
  line,
  children,
}: {
  Icon: LucideIcon;
  line: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div aria-hidden className="flex w-7 shrink-0 flex-col items-center">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground">
          <Icon className="size-3.5" />
        </div>
        <Line shown={line} />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 shadow-xs">
        {children}
      </div>
    </div>
  );
}

/** The line from an icon down to the next one: it reaches across the gap
 * between the two cards. */
function Line({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div
      data-testid="timeline-line"
      className="mt-1 -mb-2.5 w-px flex-1 bg-border"
    />
  );
}
