import { useId, useMemo, useState, type FormEvent } from "react";
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

import type { RunnableTool } from "../adapter/runnableTools";
import type { CollectionItem, Run, ToolArguments } from "../adapter/useRuns";
import { ArgumentsForm } from "./ArgumentsForm";
import {
  argumentsFromJson,
  argumentsToJson,
  fieldsOf,
  initialArguments,
  signatureOf,
  withArgument,
} from "./fields";
import { needsInput } from "./needsInput";

export type RunCardProps = {
  tool: RunnableTool;
  /** Whether WebMCP publishes it now. Otherwise it shows dimmed, without Run. */
  available: boolean;
  /**
   * The head: the action's name and signature, its description, and Run.
   * Without it, as on a tool's own view, the form is open and Run sits at
   * the foot.
   */
  head?: boolean;
  /** For a collection action: the item it runs on, when the view has one. */
  item?: CollectionItem;
  /** For a collection action without an item: the items to pick from. */
  items?: readonly CollectionItem[];
  /** This tool's runs, newest first. */
  runs: readonly Run[];
  /** Runs the tool with its input, on the item for a collection action. */
  onRun: (input: ToolArguments, item?: CollectionItem) => void;
  /** Shows a run in Runs. */
  onShowRun: (runId: number) => void;
  /** Highlights a Page Object on the page while it's hovered, by path. */
  onPreview?: (path: string) => void;
  onPreviewEnd?: () => void;
};

/**
 * The run card: runs one tool, the same way wherever something can be run.
 * Run is always there. With nothing to fill in it runs at once; otherwise
 * the first press opens the typed form and the next one runs.
 */
export function RunCard({
  tool,
  available,
  head = true,
  item,
  items = [],
  runs,
  onRun,
  onShowRun,
  onPreview,
  onPreviewEnd,
}: RunCardProps) {
  const fields = useMemo(
    () => fieldsOf(tool.argumentsSchema),
    [tool.argumentsSchema]
  );
  const [args, setArgs] = useState(() =>
    initialArguments(tool.argumentsSchema)
  );
  const [json, setJson] = useState<{ text?: string; error?: string }>();
  const [open, setOpen] = useState(false);
  const [pickedPath, setPickedPath] = useState<string>();
  const [payloadOpen, setPayloadOpen] = useState(false);

  const collection = tool.collection !== undefined;
  const picking = collection && !item;
  const target =
    item ??
    items.find((candidate) => candidate.path === pickedPath) ??
    items[0];
  const canOpen = fields.length > 0 || picking;
  const showBody = available && (!head || open);
  const needs = needsInput(tool, { itemGiven: item !== undefined });

  const cardRuns = collection
    ? runs.filter((run) => run.item?.path === target?.path)
    : runs;
  const last = cardRuns[0];
  const lastSuccess = cardRuns.find((run) => run.status === "succeeded");
  const running = last?.status === "running";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!available || running) return;
    if (head && needs && !open) {
      setOpen(true);
      return;
    }
    if (json?.error) return;
    if (!collection) onRun(args);
    else if (target) onRun({ ref: target.ref, args }, target);
  };

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
      <span className="font-mono text-[12.5px] font-semibold">
        {tool.action}
      </span>
      <span className="min-w-0 truncate font-mono text-muted-foreground">
        {signatureOf(tool.argumentsSchema)}
      </span>
    </>
  );

  return (
    <form
      aria-label={tool.action}
      data-available={available}
      className={cn(
        "mb-2 flex flex-col gap-[9px] rounded-[10px] border bg-card px-3 py-2.5",
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
                className="-mx-1.5 -my-[3px] flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left hover:bg-muted"
                onClick={() => setOpen(!open)}
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
          {fields.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-semibold">Arguments</span>
              <span className="flex-1" />
              <div
                role="group"
                aria-label="Arguments editor"
                className="flex gap-0.5 rounded-[7px] bg-muted p-0.5"
              >
                {(["Form", "JSON"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={(json !== undefined) === (mode === "JSON")}
                    className="h-[22px] rounded-[5px] px-2 text-[11.5px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
                    onClick={() => setJson(mode === "JSON" ? {} : undefined)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {picking && (
            <div className="flex flex-col gap-1">
              <span className="flex items-baseline gap-1.5 text-[11.5px] font-semibold">
                On item
                <span className="font-mono text-[11px] font-medium text-muted-foreground">
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
                          "inline-flex h-[26px] items-center gap-[5px] rounded-full border border-input bg-background px-[9px] text-xs hover:border-ring",
                          on &&
                            "border-primary bg-primary/10 font-semibold text-primary"
                        )}
                        onClick={() => setPickedPath(candidate.path)}
                        onMouseEnter={() => onPreview?.(candidate.path)}
                        onMouseLeave={onPreviewEnd}
                      >
                        <span className="font-mono">
                          {/\[\d+\]$/.exec(candidate.path)?.[0]}
                        </span>{" "}
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

          {json === undefined ? (
            <ArgumentsForm
              fields={fields}
              values={args}
              onChange={(path, value) =>
                setArgs((current) => withArgument(current, path, value))
              }
            />
          ) : (
            <JsonEditor
              text={json.text ?? argumentsToJson(args)}
              error={json.error}
              onChange={(text) => {
                const parsed = argumentsFromJson(text);
                if (parsed.ok) {
                  setArgs(parsed.arguments);
                  setJson({ text });
                } else setJson({ text, error: parsed.error });
              }}
            />
          )}

          {!head && (
            <div className="flex items-center justify-end">{runButton}</div>
          )}
        </>
      )}

      {last && (
        <LastResult
          run={last}
          lastSuccess={lastSuccess}
          payloadOpen={payloadOpen}
          onTogglePayload={() => setPayloadOpen(!payloadOpen)}
          onShowRun={onShowRun}
        />
      )}
    </form>
  );
}

function JsonEditor({
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
        className="flex items-baseline gap-1.5 text-[11.5px] font-semibold"
      >
        Arguments{" "}
        <span className="font-mono text-[11px] font-medium text-muted-foreground">
          JSON
        </span>
      </label>
      <textarea
        id={id}
        aria-invalid={error !== undefined}
        spellCheck={false}
        className="min-h-[120px] w-full resize-y rounded-md border border-input bg-muted px-[9px] py-2 font-mono text-xs leading-normal outline-none focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-ring"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <span role="alert" className="text-[11.5px] text-destructive">
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

/** The last run's status, its duration, and its payload or error. */
function LastResult({
  run,
  lastSuccess,
  payloadOpen,
  onTogglePayload,
  onShowRun,
}: {
  run: Run;
  lastSuccess: Run | undefined;
  payloadOpen: boolean;
  onTogglePayload: () => void;
  onShowRun: (runId: number) => void;
}) {
  const hasPayload = run.status === "succeeded" && run.result != null;
  const steps = `${run.steps.length} ${run.steps.length === 1 ? "step" : "steps"}`;
  const label =
    run.status === "running"
      ? "Running…"
      : run.status === "succeeded"
        ? `Succeeded · ${run.durationMs} ms · ${steps}`
        : `Failed · ${run.durationMs} ms`;
  const link =
    "cursor-pointer text-xs font-semibold underline underline-offset-2";
  return (
    <div
      role="status"
      aria-label="Last result"
      data-status={run.status}
      className="flex flex-col gap-1.5"
    >
      <div
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
          {run.status === "failed" && (
            <XIcon className="size-3.5" aria-hidden />
          )}
          <span>{label}</span>
          <span className="flex-1" />
          {hasPayload && (
            <button type="button" className={link} onClick={onTogglePayload}>
              {payloadOpen ? "Hide payload" : "Show payload"}
            </button>
          )}
          {lastSuccess && (
            <button
              type="button"
              className={cn(link, hasPayload && "ml-2.5")}
              onClick={() => onShowRun(lastSuccess.id)}
            >
              {lastSuccess === run ? "Show in runs" : "Last success ›"}
            </button>
          )}
        </div>
        {run.status === "failed" && (
          <p className="m-0 font-mono text-[11.5px] break-words">{run.error}</p>
        )}
      </div>
      {hasPayload && payloadOpen && (
        <figure aria-label="Payload" className="m-0">
          <pre className="m-0 max-h-[220px] overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px] leading-normal">
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </figure>
      )}
    </div>
  );
}
