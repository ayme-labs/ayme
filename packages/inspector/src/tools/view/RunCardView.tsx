import { useId, type FormEvent, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PlayIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@ayme-dev/design-system/components/button";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { OnHover } from "../../navigation";
import type { CollectionItem, Run } from "../../runs";
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
      disabled={running}
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
        />
      )}
    </form>
  );
}

export function JsonEditor({
  text,
  error,
  onChange,
}: {
  text: string;
  error: string | undefined;
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex items-baseline gap-1.5 text-xs font-semibold"
      >
        Arguments{" "}
        <span className="font-mono text-xs font-medium text-muted-foreground">
          JSON
        </span>
      </label>
      <textarea
        id={id}
        aria-invalid={error !== undefined}
        spellCheck={false}
        className="min-h-30 w-full resize-y rounded-md border border-input bg-muted px-2.25 py-2 font-mono text-xs leading-normal outline-none focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-ring"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

const statusStyle = {
  running: "bg-muted text-muted-foreground",
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
} as const;

/**
 * The last run's status, its duration, and its error. Its result shows in
 * Runs, which the link opens.
 */
function LastResult({
  run,
  lastSuccess,
  onShowRun,
}: {
  run: Run;
  lastSuccess: Run | undefined;
  onShowRun: (runId: number) => void;
}) {
  const steps = `${run.steps.length} ${run.steps.length === 1 ? "step" : "steps"}`;
  const label =
    run.status === "running"
      ? "Running…"
      : run.status === "succeeded"
        ? `Succeeded · ${run.durationMs} ms · ${steps}`
        : `Failed · ${run.durationMs} ms`;
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
    </div>
  );
}
