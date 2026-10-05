import type { RefObject } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeIcon,
  GlobeIcon,
  HistoryIcon,
  KeyboardIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MousePointer2Icon,
  MousePointerIcon,
  MoveIcon,
  RotateCwIcon,
  SquareCheckIcon,
  TypeIcon,
  UploadIcon,
  UserIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@ayme-dev/design-system/components/button";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { OnHover } from "../../navigation";
import type { Run, RunStep } from "../domain/run";

export type RunsViewProps = {
  /** The runs to show, newest first. */
  runs: readonly Run[];
  /** What the selection scope is called, e.g. "This object". */
  scopeLabel: string;
  /** Whether every run shows, rather than the selection's. */
  allRuns: boolean;
  onAllRunsChange: (allRuns: boolean) => void;
  /** Whether the timeline shows, or only the header. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  /** Highlights a step's member on the page while it's hovered. */
  onHover: OnHover;
  /** The timeline list, which a focused run scrolls into view in. */
  timeline: RefObject<HTMLOListElement | null>;
  /** The runs whose details are closed. */
  closedRuns: ReadonlySet<number>;
  /** The runs whose Result shows its value. */
  openResults: ReadonlySet<number>;
  /** The run that flashes, having just been brought into view. */
  flashing: number | undefined;
  toggleRun: (id: number) => void;
  toggleResult: (id: number) => void;
  /** Copies a run's result. */
  copyResult: (text: string) => void;
};

/** Runs: the timeline of the runs made from the panel, newest first. */
export function RunsView({
  runs,
  scopeLabel,
  allRuns,
  onAllRunsChange,
  open,
  onOpenChange,
  onClear,
  onHover,
  timeline,
  closedRuns,
  openResults,
  flashing,
  toggleRun,
  toggleResult,
  copyResult,
}: RunsViewProps) {
  return (
    <>
      <div
        className={cn(
          "flex h-region-header flex-none items-center gap-2 pr-2.5 pl-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase",
          open && "border-b"
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1.5 uppercase"
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRightIcon
            className={cn("size-3 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <HistoryIcon className="size-3.5" aria-hidden />
          Runs · {runs.length}
        </button>
        <span className="flex-1" />
        {open && (
          <>
            <div
              role="group"
              aria-label="Runs scope"
              className="flex gap-0.5 rounded-md bg-muted p-0.5 tracking-normal normal-case"
            >
              {[
                { label: scopeLabel, all: false },
                { label: "All", all: true },
              ].map(({ label, all }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={allRuns === all}
                  className="h-5.5 rounded-sm px-2 text-xs font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
                  onClick={() => onAllRunsChange(all)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs tracking-normal text-muted-foreground normal-case"
              disabled={!runs.length}
              onClick={onClear}
            >
              Clear
            </Button>
          </>
        )}
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-2.5 pb-3">
          {runs.length ? (
            <ol ref={timeline} aria-label="Runs timeline" className="m-0 p-0">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  open={!closedRuns.has(run.id)}
                  resultOpen={openResults.has(run.id)}
                  flashing={flashing === run.id}
                  onToggle={() => toggleRun(run.id)}
                  onToggleResult={() => toggleResult(run.id)}
                  onCopyResult={copyResult}
                  onHover={onHover}
                />
              ))}
            </ol>
          ) : (
            <p className="m-0 p-3.5 text-center text-xs text-muted-foreground">
              {allRuns || scopeLabel === "This page"
                ? "No runs yet."
                : "No runs for this selection yet. Switch to All to see every run."}
            </p>
          )}
        </div>
      )}
    </>
  );
}

const statusIcon = {
  running: {
    Icon: LoaderCircleIcon,
    label: "Running",
    className: "text-primary [&_svg]:animate-spin",
  },
  succeeded: { Icon: CheckIcon, label: "Succeeded", className: "text-success" },
  failed: { Icon: XIcon, label: "Failed", className: "text-destructive" },
} as const;

function RunRow({
  run,
  open,
  resultOpen,
  flashing,
  onToggle,
  onToggleResult,
  onCopyResult,
  onHover,
}: {
  run: Run;
  open: boolean;
  /** Whether its Result shows its value, rather than only its label. */
  resultOpen: boolean;
  flashing: boolean;
  onToggle: () => void;
  onToggleResult: () => void;
  onCopyResult: (text: string) => void;
  onHover: OnHover;
}) {
  const status = statusIcon[run.status];
  return (
    <li
      aria-label={run.toolName}
      data-run-id={run.id}
      className="flex list-none gap-2.5"
    >
      <div className="flex w-6.5 flex-none flex-col items-center">
        <span
          role="img"
          aria-label={status.label}
          className={cn(
            "grid size-6.5 flex-none place-items-center rounded-full border bg-card",
            status.className
          )}
        >
          <status.Icon className="size-3.5" aria-hidden />
        </span>
        <span className="my-0.75 w-px flex-1 bg-border" />
      </div>
      <div
        className={cn(
          "mb-2 min-w-0 flex-1 overflow-hidden rounded-lg border bg-card transition-shadow duration-200",
          flashing && "ring-2 ring-ring"
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left"
          onClick={onToggle}
        >
          <span
            role="img"
            aria-label="Run by you from the panel"
            title="Run by you from the panel"
            className="grid size-5 flex-none place-items-center rounded-sm bg-muted text-muted-foreground"
          >
            <UserIcon className="size-3" aria-hidden />
          </span>
          <span className="truncate font-mono text-xs font-semibold">
            {run.toolName}
          </span>
          {run.item && (
            <span className="rounded-md border px-1.5 font-mono text-xs text-muted-foreground">
              {run.item.pathBelowPage}
            </span>
          )}
          <span className="flex-1" />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {run.status === "running"
              ? "Running…"
              : `${run.durationMs} ms · ${new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
          </span>
        </button>
        {open && (
          <>
            {Object.keys(run.arguments).length > 0 && (
              <figure
                aria-label="Arguments"
                className="mx-2.5 mt-0 mb-1.5 rounded-md bg-muted px-2 py-1.25 font-mono text-xs [overflow-wrap:anywhere]"
              >
                {JSON.stringify(run.arguments)}
              </figure>
            )}
            {run.status === "succeeded" && run.result !== undefined && (
              <RunResult
                text={run.result}
                open={resultOpen}
                onToggle={onToggleResult}
                onCopy={onCopyResult}
              />
            )}
            {run.error && (
              <p
                role="note"
                aria-label="Error"
                className="mx-2.5 mt-0 mb-2 font-mono text-xs text-destructive"
              >
                {run.error}
              </p>
            )}
            {run.steps.length > 0 && (
              <ol
                aria-label="Steps"
                className="m-0 flex flex-col gap-0.5 px-2.5 pb-2"
              >
                {run.steps.map((step, index) => (
                  <StepRow key={index} step={step} onHover={onHover} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** What a run returned: its label and Copy, and its JSON when open. */
function RunResult({
  text,
  open,
  onToggle,
  onCopy,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="mx-2.5 mb-2 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-px text-xs font-semibold hover:bg-muted"
          onClick={onToggle}
        >
          <ChevronRightIcon
            className={cn("size-3 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          Result
        </button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => onCopy(text)}
        >
          <CopyIcon className="size-3.5" aria-hidden />
          Copy
        </Button>
      </div>
      {open && (
        <figure aria-label="Result" className="m-0">
          <pre
            // Focusable, so a keyboard can scroll a long result.
            tabIndex={0}
            className="m-0 max-h-55 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs leading-normal outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            {text}
          </pre>
        </figure>
      )}
    </div>
  );
}

// A step's operation is the method it called; the rest show a chevron.
const stepIcons: Record<string, typeof EyeIcon> = {
  click: MousePointer2Icon,
  dblclick: MousePointer2Icon,
  tap: MousePointer2Icon,
  "mouse.click": MousePointer2Icon,
  "mouse.dblclick": MousePointer2Icon,
  hover: MousePointerIcon,
  "mouse.move": MousePointerIcon,
  check: SquareCheckIcon,
  uncheck: SquareCheckIcon,
  setChecked: SquareCheckIcon,
  dragTo: MoveIcon,
  dragAndDrop: MoveIcon,
  fill: TypeIcon,
  clear: TypeIcon,
  type: TypeIcon,
  "keyboard.type": TypeIcon,
  "keyboard.insertText": TypeIcon,
  press: KeyboardIcon,
  pressSequentially: KeyboardIcon,
  "keyboard.press": KeyboardIcon,
  "keyboard.down": KeyboardIcon,
  "keyboard.up": KeyboardIcon,
  selectOption: ListChecksIcon,
  setInputFiles: UploadIcon,
  goto: GlobeIcon,
  goBack: ArrowLeftIcon,
  goForward: ArrowRightIcon,
  reload: RotateCwIcon,
  waitFor: EyeIcon,
};

function StepRow({ step, onHover }: { step: RunStep; onHover: OnHover }) {
  const Icon = stepIcons[step.operation] ?? ChevronRightIcon;
  const value =
    step.value !== undefined ? JSON.stringify(step.value) : step.state;
  const member = step.member;
  return (
    <li className="flex min-h-6 list-none items-center gap-2 text-xs">
      <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
      <span className="w-27.5 flex-none text-muted-foreground">
        {step.operation}
      </span>
      {step.locator !== undefined && (
        <button
          type="button"
          data-gone={member === undefined || undefined}
          title={
            member === undefined
              ? `Not on the page when the run ended: ${step.locator}`
              : `${step.locator}. Hover to highlight it on the page.`
          }
          className="max-w-57.5 cursor-crosshair truncate rounded-sm border bg-background px-1.5 py-px font-mono text-xs hover:border-ring data-gone:cursor-default data-gone:border-dashed data-gone:text-muted-foreground"
          // The hover highlight finds the member's element while it's there.
          onMouseEnter={() => member !== undefined && onHover({ path: member })}
          onMouseLeave={() => member !== undefined && onHover(undefined)}
        >
          {member ?? step.locator}
        </button>
      )}
      {value !== undefined && (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {value}
        </span>
      )}
    </li>
  );
}
