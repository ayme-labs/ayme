import type {
  RecorderCommand,
  RecorderCommandType,
  RecordedVisit,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import {
  Activity,
  Eye,
  Globe,
  Keyboard,
  MousePointer2,
  SquareMousePointer,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

import {
  entryCardOf,
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
  change: Activity,
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
   * restored when it lists those. */
  commands: readonly RecorderCommandType[];
  onCommand: OnCommand;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6">
      {visits.length === 0 ? (
        <p
          data-testid="timeline-empty"
          className="py-16 text-center text-sm text-muted-foreground"
        >
          Nothing is recorded yet. Press Record to start with the page as it is
          now.
        </p>
      ) : (
        visits.map((visit, index) => (
          <VisitSection
            key={visit.visitId}
            visit={visit}
            number={index + 1}
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
  commands,
  onCommand,
}: {
  visit: RecordedVisit;
  number: number;
  commands: readonly RecorderCommandType[];
  onCommand: OnCommand;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3">
      <h2
        id={heading}
        className="flex items-center gap-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
      >
        Page {number}
      </h2>
      <EntryFrame Icon={Globe}>
        <p
          data-testid="visit-start"
          className="text-sm break-all text-muted-foreground"
        >
          {visit.cause === "openPage" ? "Opened" : "Navigated to"} {visit.url}
        </p>
      </EntryFrame>
      {visit.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          commands={commands}
          onCommand={onCommand}
        />
      ))}
    </section>
  );
}

/** One entry, with the controls that review it on its header's right. An
 * entry the person left out stays where it is, dimmed, with what it changed
 * hidden. How it shows is read from it (`entryCardOf`): the view only lays
 * it out. */
function EntryCard({
  entry,
  commands,
  onCommand,
}: {
  entry: TimelineEntry;
  commands: readonly RecorderCommandType[];
  onCommand: OnCommand;
}) {
  const heading = useId();
  const card = entryCardOf(entry, commands);
  return (
    <EntryFrame Icon={ICONS[card.icon]}>
      <article aria-labelledby={heading} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            data-testid="entry-content"
            data-discarded={card.discarded}
            className="flex min-w-0 flex-wrap items-center gap-3 data-[discarded=true]:opacity-50"
          >
            <h3 id={heading} className="font-semibold">
              {card.title}
            </h3>
            <Target card={card} onCommand={onCommand} />
          </div>
          <Discarded card={card} />
          <Review card={card} onCommand={onCommand} />
        </div>
        <Changes card={card} />
      </article>
    </EntryFrame>
  );
}

/** The Interaction's target. Hovering it highlights its element on the
 * page. */
function Target({ card, onCommand }: { card: Card; onCommand: OnCommand }) {
  if (!card.target) return null;
  const { enter, leave } = card.hover;
  return (
    <span
      data-testid="entry-target"
      onMouseEnter={() => enter && onCommand(enter)}
      onMouseLeave={() => leave && onCommand(leave)}
      className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm break-all"
    >
      {card.target}
    </span>
  );
}

function Discarded({ card }: { card: Card }) {
  if (!card.discarded) return null;
  return (
    <span
      data-testid="entry-discarded"
      className="text-sm text-muted-foreground"
    >
      Discarded
    </span>
  );
}

/** Discard, or Restore, when it applies now. */
function Review({ card, onCommand }: { card: Card; onCommand: OnCommand }) {
  if (!card.review) return null;
  const { label, command } = card.review;
  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => onCommand(command)}
    >
      {label}
    </Button>
  );
}

/** The roots of what the entry changed. */
function Changes({ card }: { card: Card }) {
  if (card.changes.length === 0) return null;
  return (
    <ul aria-label="What changed" className="flex flex-col gap-2 border-t pt-3">
      {card.changes.map((change, index) => (
        <li key={index} className="flex flex-wrap items-center gap-2">
          <span
            data-testid="change-element"
            className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm break-all"
          >
            {change.element}
          </span>
          <span
            data-testid="change-effect"
            className="text-sm text-muted-foreground"
          >
            {change.effect}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** An entry's place on the timeline: its icon on the left, its card. */
function EntryFrame({
  Icon,
  children,
}: {
  Icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground"
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border bg-card px-4 py-3 shadow-xs">
        {children}
      </div>
    </div>
  );
}
