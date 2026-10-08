import { useId, useRef, type FormEvent, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PlayIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import type { SchemaViolation } from "@ayme-dev/ayme/internal";
import { Button } from "@ayme-dev/design-system/components/button";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { OnHover } from "../../navigation";
import { RunImageView, type CollectionItem, type Run } from "../../runs";
import type { Field } from "../domain/fields";
import type { RunnableTool } from "../domain/runnableTools";

/**
 * The run card: runs one tool, the same way wherever something can be run.
 * Run is always there; its form is the `form` it's given.
 */
export function RunCardView({
  tool,
  available,
  head,
  items,
  onHover,
  onShowRun,
  onOpenImage,
  signature,
  fields,
  json,
  open,
  picking,
  target,
  canOpen,
  showBody,
  needs,
  last,
  lastSuccess,
  running,
  invalid,
  submit,
  toggleOpen,
  pickItem,
  showJson,
  form,
}: {
  tool: RunnableTool;
  /** Whether WebMCP publishes it now. Otherwise it shows dimmed, without Run. */
  available: boolean;
  /** Whether it shows its head: the action's name, signature, description and Run. */
  head: boolean;
  /** For a collection action without an item: the items to pick from. */
  items: readonly CollectionItem[];
  /** Highlights an item on the page while it's hovered. */
  onHover?: OnHover;
  /** Shows a run in Runs. */
  onShowRun: (runId: number) => void;
  /** Opens the last run's image, given its data URL, full size. */
  onOpenImage: (src: string) => void;
  /** Its arguments, e.g. "(text: string)". */
  signature: string;
  fields: readonly Field[];
  /** The JSON editor's state, while it edits the arguments. */
  json: { text?: string; error?: string } | undefined;
  /** Whether the form is open under the head. */
  open: boolean;
  /** Whether the person picks the item it runs on. */
  picking: boolean;
  /** The item it runs on. */
  target: CollectionItem | undefined;
  /** Whether it has a form to open. */
  canOpen: boolean;
  /** Whether the form shows. */
  showBody: boolean;
  /** Whether Run must open the form before it runs. */
  needs: boolean;
  /** Its last run, and its last successful one. */
  last: Run | undefined;
  lastSuccess: Run | undefined;
  running: boolean;
  /**
   * Whether the arguments can't be sent as they are, so Run is off: a field
   * is invalid, or the JSON is, or it breaks the tool's schema.
   */
  invalid: boolean;
  submit: (event: FormEvent) => void;
  toggleOpen: () => void;
  pickItem: (path: string) => void;
  showJson: (shown: boolean) => void;
  /** The form: fill_form's fields, the typed form, or the JSON editor. */
  form: ReactNode;
}) {
  const runButton = available && (
    <Button
      type="submit"
      size="sm"
      className="h-7 px-2.5 text-xs"
      disabled={running || invalid}
      title={
        head && needs && !open
          ? "Fill in the arguments, then run"
          : `Run ${tool.action}`
      }
    >
      <PlayIcon className="size-3.5" aria-hidden />
      Run
    </Button>
  );
  const name = (
    <>
      <ZapIcon className="size-3.5 flex-none text-primary" aria-hidden />
      <span className="font-mono text-xs font-semibold">{tool.action}</span>
      <span className="w-0 min-w-0 flex-1 truncate font-mono text-muted-foreground">
        {signature}
      </span>
    </>
  );

  return (
    <form
      aria-label={tool.action}
      data-available={available}
      className={cn(
        "mb-2 flex flex-col gap-2.25 rounded-lg border bg-card px-3 py-2.5",
        !available && "opacity-60"
      )}
      onSubmit={submit}
    >
      {head && (
        <>
          <div className="flex items-center gap-1.5">
            {available && canOpen ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} the arguments for ${tool.action}`}
                className="-mx-1.5 -my-0.75 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.75 text-left hover:bg-muted"
                onClick={toggleOpen}
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 flex-none text-muted-foreground transition-transform",
                    open && "rotate-90"
                  )}
                  aria-hidden
                />
                {name}
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {name}
              </span>
            )}
            {runButton}
          </div>
          {tool.description && (
            <p className="m-0 text-xs text-muted-foreground">
              {tool.description}
            </p>
          )}
        </>
      )}

      {showBody && (
        <>
          {fields.length > 0 && !tool.fillForm && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold">Arguments</span>
              <span className="flex-1" />
              <div
                role="group"
                aria-label="Arguments editor"
                className="flex gap-0.5 rounded-md bg-muted p-0.5"
              >
                {(["Form", "JSON"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={(json !== undefined) === (mode === "JSON")}
                    className="h-5.5 rounded-sm px-2 text-xs font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
                    onClick={() => showJson(mode === "JSON")}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {picking && (
            <div className="flex flex-col gap-1">
              <span className="flex items-baseline gap-1.5 text-xs font-semibold">
                On item
                <span className="font-mono text-xs font-medium text-muted-foreground">
                  ref
                </span>
              </span>
              {items.length ? (
                <div
                  role="radiogroup"
                  aria-label="Item"
                  className="flex flex-wrap gap-1.5"
                >
                  {items.map((candidate) => {
                    const on = candidate.path === target?.path;
                    return (
                      <button
                        key={candidate.path}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={cn(
                          "inline-flex h-6.5 items-center gap-1.25 rounded-full border border-input bg-background px-2.25 text-xs hover:border-ring",
                          on &&
                            "border-primary bg-primary/10 font-semibold text-primary"
                        )}
                        onClick={() => pickItem(candidate.path)}
                        onMouseEnter={() => onHover?.({ path: candidate.path })}
                        onMouseLeave={() => onHover?.(undefined)}
                      >
                        <span className="font-mono">{candidate.name}</span>{" "}
                        {candidate.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">
                  No items are on the page.
                </p>
              )}
            </div>
          )}

          {form}

          {!head && (
            <div className="flex items-center justify-end">{runButton}</div>
          )}
        </>
      )}

      {last && (
        <LastResult
          run={last}
          lastSuccess={lastSuccess}
          onShowRun={onShowRun}
          onOpenImage={onOpenImage}
        />
      )}
    </form>
  );
}

/**
 * The arguments as JSON, with line numbers. It marks the line of a syntax
 * error, lists how valid JSON breaks the tool's schema by path, and formats
 * the text on demand.
 */
export function JsonEditor({
  text,
  error,
  errorLine,
  violations,
  onChange,
  onFormat,
}: {
  text: string;
  error: string | undefined;
  /** The line of the syntax error, 1-based. */
  errorLine: number | undefined;
  violations: readonly SchemaViolation[];
  onChange: (text: string) => void;
  onFormat: () => void;
}) {
  const id = useId();
  const gutter = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lineCount = text.split("\n").length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <label
          htmlFor={id}
          className="flex items-baseline gap-1.5 text-xs font-semibold"
        >
          Arguments{" "}
          <span className="font-mono text-xs font-medium text-muted-foreground">
            JSON
          </span>
        </label>
        <span className="flex-1" />
        <button
          type="button"
          disabled={error !== undefined}
          title={error ? "Fix the JSON to format it" : "Pretty-print the JSON"}
          className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:text-muted-foreground"
          onClick={() => {
            onFormat();
            // Formatted lines start at the left edge; show them from there.
            if (textarea.current) textarea.current.scrollLeft = 0;
          }}
        >
          Format
        </button>
      </div>
      <div className="flex rounded-md border border-input bg-muted focus-within:border-transparent focus-within:outline-2 focus-within:outline-ring">
        <div
          ref={gutter}
          aria-hidden
          className="flex-none overflow-hidden border-r border-input py-2 pr-1.5 pl-2 text-right font-mono text-xs leading-normal text-muted-foreground select-none"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div
              key={index}
              data-error={index + 1 === errorLine || undefined}
              className="data-error:font-semibold data-error:text-destructive"
            >
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textarea}
          id={id}
          aria-invalid={error !== undefined || violations.length > 0}
          aria-describedby={`${id}-errors`}
          spellCheck={false}
          wrap="off"
          className="min-h-30 w-0 min-w-0 flex-1 resize-y bg-transparent px-2.25 py-2 font-mono text-xs leading-normal outline-none"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (gutter.current)
              gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      <div id={`${id}-errors`}>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
        {violations.length > 0 && (
          <ul
            role="alert"
            aria-label="Schema errors"
            className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-destructive"
          >
            {violations.map(({ path, message }) => (
              <li key={`${path} ${message}`}>
                <span className="font-mono font-semibold">
                  {path || "arguments"}
                </span>
                : {message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const statusStyle = {
  running: "bg-muted text-muted-foreground",
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
} as const;

/**
 * The last run's status, its duration, and its error, or the image it
 * returned. Its result shows in Runs, which the link opens.
 */
function LastResult({
  run,
  lastSuccess,
  onShowRun,
  onOpenImage,
}: {
  run: Run;
  lastSuccess: Run | undefined;
  onShowRun: (runId: number) => void;
  onOpenImage: (src: string) => void;
}) {
  const steps = `${run.steps.length} ${run.steps.length === 1 ? "step" : "steps"}`;
  // A run interrupted by a reload has no known duration.
  const duration =
    run.durationMs === undefined ? "" : ` · ${run.durationMs} ms`;
  const label =
    run.status === "running"
      ? "Running…"
      : run.status === "succeeded"
        ? run.image
          ? `Screenshot${duration}`
          : `Succeeded${duration} · ${steps}`
        : `Failed${duration}`;
  return (
    <div
      role="status"
      aria-label="Last result"
      data-status={run.status}
      className={cn(
        "flex flex-col gap-1 rounded-md px-2 py-1.5 text-xs",
        statusStyle[run.status]
      )}
    >
      <div className="flex items-center gap-1.5">
        {run.status === "running" && (
          <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
        )}
        {run.status === "succeeded" && (
          <CheckIcon className="size-3.5" aria-hidden />
        )}
        {run.status === "failed" && <XIcon className="size-3.5" aria-hidden />}
        <span>{label}</span>
        <span className="flex-1" />
        {lastSuccess && (
          <button
            type="button"
            className="cursor-pointer text-xs font-semibold underline underline-offset-2"
            onClick={() => onShowRun(lastSuccess.id)}
          >
            {lastSuccess === run ? "Show in runs" : "Last success ›"}
          </button>
        )}
      </div>
      {run.status === "failed" && (
        <p className="m-0 font-mono text-xs break-words">{run.error}</p>
      )}
      {run.status === "succeeded" && run.image && (
        <RunImageView image={run.image} onOpen={onOpenImage} />
      )}
    </div>
  );
}
