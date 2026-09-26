import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  HistoryIcon,
  KeyboardIcon,
  LoaderCircleIcon,
  MousePointer2Icon,
  TypeIcon,
  UserIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@ayme-dev/design-system/components/button";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { RunStep } from "../adapter/runSteps";
import type { Run } from "../adapter/useRuns";

/** A request to bring one run into view. A new `at` repeats it. */
export type RunFocus = { runId: number; at: number };

export type RunsProps = {
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
  focus?: RunFocus;
  /** Highlights a step's element. Resolves to whether it's still on the page. */
  onPreviewStep: (step: RunStep) => Promise<boolean>;
  onPreviewStepEnd: () => void;
};

/** Runs: the timeline of the runs made from the panel, newest first. */
export function Runs({
  runs,
  scopeLabel,
  allRuns,
  onAllRunsChange,
  open,
  onOpenChange,
  onClear,
  focus,
  onPreviewStep,
  onPreviewStepEnd,
}: RunsProps) {
  const [closedRuns, setClosedRuns] = useState<ReadonlySet<number>>(new Set());
  const [flashing, setFlashing] = useState<number>();
  const timeline = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!focus) return;
    setClosedRuns((closed) => {
      const next = new Set(closed);
      next.delete(focus.runId);
      return next;
    });
    setFlashing(focus.runId);
    const row = timeline.current?.querySelector(
      `[data-run-id="${focus.runId}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
    const timer = setTimeout(() => setFlashing(undefined), 1800);
    return () => clearTimeout(timer);
  }, [focus]);

  const toggleRun = (id: number) =>
    setClosedRuns((closed) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <div
        className={cn(
          "flex h-[38px] flex-none items-center gap-2 pr-2.5 pl-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
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
              className="flex gap-0.5 rounded-[7px] bg-muted p-0.5 tracking-normal normal-case"
            >
              {[
                { label: scopeLabel, all: false },
                { label: "All", all: true },
              ].map(({ label, all }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={allRuns === all}
                  className="h-[22px] rounded-[5px] px-2 text-[11.5px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
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
                  flashing={flashing === run.id}
                  onToggle={() => toggleRun(run.id)}
                  onPreviewStep={onPreviewStep}
                  onPreviewStepEnd={onPreviewStepEnd}
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
  flashing,
  onToggle,
  onPreviewStep,
  onPreviewStepEnd,
}: {
  run: Run;
  open: boolean;
  flashing: boolean;
  onToggle: () => void;
  onPreviewStep: RunsProps["onPreviewStep"];
  onPreviewStepEnd: () => void;
}) {
  const status = statusIcon[run.status];
  return (
    <li
      aria-label={run.toolName}
      data-run-id={run.id}
      className="flex list-none gap-2.5"
    >
      <div className="flex w-[26px] flex-none flex-col items-center">
        <span
          role="img"
          aria-label={status.label}
          className={cn(
            "grid size-[26px] flex-none place-items-center rounded-full border bg-card",
            status.className
          )}
        >
          <status.Icon className="size-3.5" aria-hidden />
        </span>
        <span className="my-[3px] w-px flex-1 bg-border" />
      </div>
      <div
        className={cn(
          "mb-2 min-w-0 flex-1 overflow-hidden rounded-[10px] border bg-card transition-shadow duration-200",
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
            className="grid size-5 flex-none place-items-center rounded-[5px] bg-muted text-muted-foreground"
          >
            <UserIcon className="size-3" aria-hidden />
          </span>
          <span className="truncate font-mono text-xs font-semibold">
            {run.toolName}
          </span>
          {run.item && (
            <span className="rounded-md border px-1.5 font-mono text-[11px] text-muted-foreground">
              {run.item.path.slice(run.item.path.indexOf(".") + 1)}
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">
            {run.status === "running"
              ? "Running…"
              : `${run.durationMs} ms · ${new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
          </span>
        </button>
        {open && (
          <>
            <div className="mx-2.5 mb-1.5 rounded-md bg-muted px-2 py-[5px] font-mono text-[11.5px] [overflow-wrap:anywhere]">
              {JSON.stringify(run.arguments)}
            </div>
            {run.error && (
              <p
                role="note"
                aria-label="Error"
                className="mx-2.5 mt-0 mb-2 font-mono text-[11.5px] text-destructive"
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
                  <StepRow
                    key={index}
                    step={step}
                    onPreview={onPreviewStep}
                    onPreviewEnd={onPreviewStepEnd}
                  />
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </li>
  );
}

const stepIcons: Partial<Record<RunStep["operation"], typeof EyeIcon>> = {
  click: MousePointer2Icon,
  fill: TypeIcon,
  press: KeyboardIcon,
  pressSequentially: KeyboardIcon,
  waitFor: EyeIcon,
};

function StepRow({
  step,
  onPreview,
  onPreviewEnd,
}: {
  step: RunStep;
  onPreview: RunsProps["onPreviewStep"];
  onPreviewEnd: () => void;
}) {
  const [gone, setGone] = useState(false);
  const Icon = stepIcons[step.operation] ?? ChevronRightIcon;
  const value =
    step.value !== undefined ? JSON.stringify(step.value) : step.state;
  return (
    <li className="flex min-h-6 list-none items-center gap-2 text-xs">
      <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
      <span className="w-[110px] flex-none text-muted-foreground">
        {step.operation}
      </span>
      <button
        type="button"
        data-gone={gone || undefined}
        title={
          gone
            ? `Not on the page now: ${step.locator}`
            : `${step.locator}. Hover to highlight it on the page.`
        }
        className="max-w-[230px] cursor-crosshair truncate rounded-[5px] border bg-background px-1.5 py-px font-mono text-[11.5px] hover:border-ring data-gone:cursor-default data-gone:border-dashed data-gone:text-muted-foreground"
        onMouseEnter={() =>
          void onPreview(step).then((found) => setGone(!found))
        }
        onMouseLeave={onPreviewEnd}
      >
        {step.member ?? step.locator}
      </button>
      {value !== undefined && (
        <span className="truncate font-mono text-[11.5px] text-muted-foreground">
          {value}
        </span>
      )}
    </li>
  );
}
