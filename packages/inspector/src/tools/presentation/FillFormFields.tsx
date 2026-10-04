import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { GripVerticalIcon, RotateCcwIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { Run } from "../../runs";
import { inputClass } from "../view/ArgumentsFormView";
import {
  changedFields,
  formRows,
  inFillOrder,
  isChanged,
  type FormField,
  type FormRow,
} from "../domain/fillForm";
import type { RefSource } from "../domain/refTree";

/**
 * `fill_form`'s form: every fillable element on the page as the control it
 * is, holding the value the page shows now. The rows the person changes
 * become `fields`, in the list's order; dragging a row changes the order.
 */
export function FillFormFields({
  source,
  lastRun,
  onChange,
}: {
  /** The page's structure, and its hover preview. */
  source: RefSource;
  /** The tool's last run: a field it couldn't fill marks its row. */
  lastRun: Run | undefined;
  /** Gets the fields to fill whenever they change. */
  onChange: (fields: FormField[]) => void;
}) {
  const { roots, onPreview, onPreviewEnd } = source;
  const pageRows = useMemo(() => formRows(roots), [roots]);
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(new Map());
  const [order, setOrder] = useState<readonly string[]>();
  const [dragged, setDragged] = useState<string>();
  const [over, setOver] = useState<string>();

  const rows = useMemo(() => inFillOrder(pageRows, order), [pageRows, order]);
  const fields = useMemo(() => changedFields(rows, edits), [rows, edits]);
  const failure = outcomeOf(lastRun)?.failure;

  // A change the page now shows, after a run or typed on the page, is done,
  // as is a radio choice whose radio left the page.
  useEffect(() => {
    setEdits((current) => {
      const left = new Map(current);
      for (const row of pageRows)
        if (left.has(row.key) && !isChanged(row, left)) left.delete(row.key);
      return left.size === current.size ? current : left;
    });
  }, [pageRows]);

  // A change the last run filled is done too, even when the page shows it
  // differently, e.g. trimmed. Runs from before the form opened are not its.
  const settled = useRef(lastRun?.id);
  useEffect(() => {
    const outcome = outcomeOf(lastRun);
    if (!outcome || settled.current === lastRun?.id) return;
    settled.current = lastRun?.id;
    setEdits((current) => {
      const left = new Map(current);
      for (const [key, value] of current)
        if (
          outcome.filled.some((field) =>
            field.type === "radio"
              ? field.target === value
              : field.target === key && field.value === value
          )
        )
          left.delete(key);
      return left.size === current.size ? current : left;
    });
  }, [lastRun]);

  useEffect(() => onChange(fields), [fields, onChange]);

  const edit = (row: FormRow, value: string | undefined) =>
    setEdits((current) => {
      const next = new Map(current);
      if (value === undefined || value === row.value) next.delete(row.key);
      else next.set(row.key, value);
      return next;
    });

  const move = (key: string, to: number) => {
    const keys = rows.map((row) => row.key).filter((other) => other !== key);
    keys.splice(Math.max(0, Math.min(to, keys.length)), 0, key);
    setOrder(keys);
  };
  const onGripKey = (event: KeyboardEvent, key: string, index: number) => {
    const by = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    move(key, index + by);
  };
  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragged !== undefined) move(dragged, index);
    setDragged(undefined);
    setOver(undefined);
  };

  let fillOrder = 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold">Fields</span>
        <span
          role="status"
          aria-label="Changed fields"
          className="text-xs text-muted-foreground"
        >
          {fields.length} changed
        </span>
        <span className="flex-1" />
        {edits.size > 0 && (
          <button
            type="button"
            className="h-5.5 rounded-sm border px-2 text-xs font-medium hover:border-ring"
            onClick={() => setEdits(new Map())}
          >
            Undo all
          </button>
        )}
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        Every field on the page, holding what it shows now. The ones you change
        are filled, in the numbered order; drag a row to change it.
      </p>
      {rows.length === 0 ? (
        <p className="m-0 rounded-lg border p-3 text-center text-xs text-muted-foreground">
          No fields are on the page.
        </p>
      ) : (
        <ul
          aria-label="Form fields"
          className="m-0 flex list-none flex-col rounded-lg border p-0"
        >
          {rows.map((row, index) => {
            const changed = isChanged(row, edits);
            const failed =
              failure &&
              (row.key === failure.target ||
                row.options?.some((option) => option.value === failure.target))
                ? failure.error
                : undefined;
            return (
              <li
                key={row.key}
                data-failed={failed !== undefined}
                className={cn(
                  "grid grid-cols-[--spacing(4.5)_--spacing(4.5)_minmax(0,1fr)] items-start gap-1.5 border-t py-2 pr-2.5 pl-1 first:border-t-0",
                  over === row.key &&
                    dragged !== row.key &&
                    "shadow-[inset_0_2px_0_var(--color-primary)]",
                  failed !== undefined && "bg-destructive/10"
                )}
                onMouseEnter={() => onPreview?.(row.preview)}
                onMouseLeave={onPreviewEnd}
                onDragOver={(event) => {
                  if (dragged === undefined) return;
                  event.preventDefault();
                  setOver(row.key);
                }}
                onDrop={(event) => onDrop(event, index)}
              >
                <button
                  type="button"
                  draggable
                  aria-label={`Move ${row.name || row.type}`}
                  title="Drag to change the fill order"
                  className="mt-0.5 grid h-5.5 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", row.key);
                    setDragged(row.key);
                  }}
                  onDragEnd={() => {
                    setDragged(undefined);
                    setOver(undefined);
                  }}
                  onKeyDown={(event) => onGripKey(event, row.key, index)}
                >
                  <GripVerticalIcon className="size-3.5" aria-hidden />
                </button>
                {changed ? (
                  <span
                    aria-label="Fill order"
                    className="mt-0.75 grid size-4.5 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                  >
                    {++fillOrder}
                  </span>
                ) : (
                  <span />
                )}
                <FieldRow
                  row={row}
                  value={edits.get(row.key) ?? row.value}
                  changed={changed}
                  error={failed}
                  onChange={(value) => edit(row, value)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A row's label, its undo, and its control. */
function FieldRow({
  row,
  value,
  changed,
  error,
  onChange,
}: {
  row: FormRow;
  value: string;
  changed: boolean;
  error: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const name = row.name || row.type;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-5.5 items-center gap-1.5">
        <label
          htmlFor={row.type === "radio" ? undefined : id}
          className={cn(
            "min-w-0 truncate text-xs font-semibold",
            !changed && "text-muted-foreground"
          )}
        >
          {name}
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {row.type}
        </span>
        <span className="flex-1" />
        {changed && (
          <button
            type="button"
            aria-label={`Undo the change to ${name}`}
            title="Undo: keep what the page shows"
            className="grid size-5.5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(undefined)}
          >
            <RotateCcwIcon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <FieldControl
        id={id}
        name={name}
        row={row}
        value={value}
        onChange={onChange}
      />
      {error !== undefined && (
        <span className="font-mono text-xs break-words text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** The control that fits the row's type, holding `value`. */
function FieldControl({
  id,
  name,
  row,
  value,
  onChange,
}: {
  id: string;
  name: string;
  row: FormRow;
  value: string;
  onChange: (value: string) => void;
}) {
  const { options, range } = row;
  if (row.type === "radio")
    return (
      <div
        id={id}
        role="radiogroup"
        aria-label={name}
        className="flex flex-wrap gap-0.5 self-start rounded-md bg-muted p-0.5"
      >
        {options!.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className="rounded-sm px-2.5 py-1 text-xs text-muted-foreground aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-xs"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  if (row.type === "checkbox")
    return (
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          id={id}
          type="checkbox"
          aria-label={name}
          checked={value === "true"}
          onChange={(event) => onChange(String(event.target.checked))}
        />
        {value === "true" ? "Checked" : "Unchecked"}
      </label>
    );
  if (row.type === "combobox" && options)
    return (
      <select
        id={id}
        aria-label={name}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {!options.some((option) => option.value === value) && (
          <option value={value}>{value || "—"}</option>
        )}
        {options.map((option, index) => (
          <option key={index} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (row.type === "slider" && range)
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          aria-label={name}
          className="min-w-0 flex-1 accent-primary"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="font-mono text-xs">{value}</span>
      </div>
    );
  if (row.multiline)
    return (
      <textarea
        id={id}
        aria-label={name}
        rows={2}
        className={`${inputClass} h-auto py-1.5`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <input
      id={id}
      type="text"
      aria-label={name}
      className={inputClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * What the last run did, when it returned: the fields it filled and, when it
 * stopped at one it couldn't fill, that field's target and why.
 */
function outcomeOf(run: Run | undefined) {
  if (run?.status !== "succeeded" || run.result === undefined) return;
  let result: unknown;
  try {
    result = JSON.parse(run.result);
  } catch {
    return;
  }
  const { filled, failed } = (result ?? {}) as {
    filled?: unknown;
    failed?: { error?: unknown };
  };
  const fields = run.arguments.fields;
  if (!Array.isArray(filled) || !Array.isArray(fields)) return;
  const sent = fields as Partial<FormField>[];
  const stopped = failed ? sent[filled.length] : undefined;
  return {
    filled: sent.slice(0, filled.length),
    failure:
      typeof stopped?.target === "string"
        ? { target: stopped.target, error: String(failed?.error ?? "") }
        : undefined,
  };
}
