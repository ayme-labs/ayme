import type {
  RecorderCommand,
  RecorderCommandType,
  RecordedVisit,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import {
  Activity,
  Globe,
  Keyboard,
  MousePointer2,
  SquareMousePointer,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

import { changeRoots, type ChangeRoot } from "../domain/changeRoots";
import { interactionTitle, targetLabel } from "../domain/entryText";

const EFFECT: Record<ChangeRoot["kind"], string> = {
  added: "appeared",
  removed: "was removed",
  changed: "changed",
};

const ICONS: Record<string, LucideIcon> = {
  click: MousePointer2,
  press: Keyboard,
  fill: Type,
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
  onCommand(command: RecorderCommand): void;
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
  onCommand(command: RecorderCommand): void;
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
 * hidden. */
function EntryCard({
  entry,
  commands,
  onCommand,
}: {
  entry: TimelineEntry;
  commands: readonly RecorderCommandType[];
  onCommand(command: RecorderCommand): void;
}) {
  const heading = useId();
  const interaction = entry.kind === "interaction" ? entry.interaction : null;
  const target = interaction && targetLabel(interaction);
  const discarded = entry.discarded === true;
  const roots =
    entry.changeTree && !discarded ? changeRoots(entry.changeTree) : [];
  return (
    <EntryFrame
      Icon={
        interaction ? (ICONS[interaction.type] ?? SquareMousePointer) : Activity
      }
    >
      <article aria-labelledby={heading} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            data-testid="entry-content"
            className={`flex min-w-0 flex-wrap items-center gap-3 ${discarded ? "opacity-50" : ""}`}
          >
            <h3 id={heading} className="font-semibold">
              {interaction
                ? interactionTitle(interaction)
                : "Change without an Interaction"}
            </h3>
            {target && (
              <span
                data-testid="entry-target"
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm break-all"
              >
                {target}
              </span>
            )}
          </div>
          {discarded && (
            <span
              data-testid="entry-discarded"
              className="text-sm text-muted-foreground"
            >
              Discarded
            </span>
          )}
          {discarded && commands.includes("restore") && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onCommand({ type: "restore", entry: entry.id })}
            >
              Restore
            </Button>
          )}
          {!discarded && commands.includes("discard") && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onCommand({ type: "discard", entry: entry.id })}
            >
              Discard
            </Button>
          )}
        </div>
        {roots.length > 0 && (
          <ul
            aria-label="What changed"
            className="flex flex-col gap-2 border-t pt-3"
          >
            {roots.map((root, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="change-element"
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm break-all"
                >
                  {root.element}
                </span>
                <span
                  data-testid="change-effect"
                  className="text-sm text-muted-foreground"
                >
                  {EFFECT[root.kind]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </EntryFrame>
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
