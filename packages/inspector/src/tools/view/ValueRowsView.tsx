import type { KeyboardEvent } from "react";
import { XIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { ValueRow, ValueType } from "../domain/valueRows";

const inputClass =
  "h-7.5 w-full min-w-0 rounded-md border border-input bg-background px-2.25 font-mono text-xs outline-none focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-destructive";

const columns =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_1.625rem] gap-1";

type Part = "label" | "value";

/** A map of labelled values as rows: label, value, type, and remove. */
export function ValueRowsView({
  name,
  description,
  maxEntries,
  rows,
  count,
  switchable,
  register,
  add,
  remove,
  setLabel,
  setValue,
  switchType,
  keyDown,
}: {
  name: string;
  description?: string;
  maxEntries?: number;
  rows: readonly (ValueRow & { type: ValueType; problem?: string })[];
  count: number;
  switchable: boolean;
  register: (
    part: Part,
    row: number
  ) => (element: HTMLInputElement | null) => void;
  add: () => void;
  remove: (index: number) => void;
  setLabel: (index: number, label: string) => void;
  setValue: (index: number, value: string) => void;
  switchType: (index: number) => void;
  keyDown: (index: number, part: Part, event: KeyboardEvent) => void;
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-col gap-1.5">
      {description && (
        <p
          role="note"
          aria-label={`${name} description`}
          className="m-0 text-xs text-muted-foreground"
        >
          {description}
        </p>
      )}
      {rows.length > 0 && (
        <div
          aria-hidden
          className={cn(
            columns,
            "font-mono text-[0.625rem] font-medium tracking-wider text-muted-foreground uppercase"
          )}
        >
          <span>Label</span>
          <span>Value</span>
          <span>Type</span>
        </div>
      )}
      {rows.map((row, index) => {
        const n = index + 1;
        const guessed = row.fixed === null;
        const shown = row.type === "number" ? "number" : "text";
        return (
          <div key={index} className="flex flex-col gap-0.5">
            <div className={cn(columns, "items-center")}>
              <input
                ref={register("label", index)}
                aria-label={`${name} label ${n}`}
                placeholder="label"
                className={inputClass}
                value={row.label}
                onChange={(event) => setLabel(index, event.target.value)}
                onKeyDown={(event) => keyDown(index, "label", event)}
              />
              <input
                ref={register("value", index)}
                aria-label={`${name} value ${n}`}
                aria-invalid={row.problem !== undefined}
                placeholder="value"
                className={inputClass}
                value={row.value}
                onChange={(event) => setValue(index, event.target.value)}
                onKeyDown={(event) => keyDown(index, "value", event)}
              />
              <button
                type="button"
                aria-label={`${name} type ${n}`}
                title={
                  !switchable
                    ? undefined
                    : guessed
                      ? "Guessed from the value. Click to fix the other type."
                      : "Fixed. Click to switch between text and number."
                }
                disabled={!switchable}
                className={cn(
                  "h-6.5 w-full rounded-md border px-1.5 font-mono text-[0.6875rem] whitespace-nowrap",
                  shown === "number"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-input bg-muted text-foreground",
                  guessed && switchable && "border-dashed"
                )}
                onClick={() => switchType(index)}
              >
                {/* A dashed border shows a guess; the word says so to a screen reader. */}
                {guessed && switchable && (
                  <span className="sr-only">auto · </span>
                )}
                {shown}
              </button>
              <button
                type="button"
                aria-label={`Remove ${name} ${n}`}
                className="grid size-6.5 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                onClick={() => remove(index)}
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </div>
            {row.problem && (
              <p
                role="status"
                aria-label={`${name} problem ${n}`}
                className="m-0 text-xs text-destructive"
              >
                {row.problem}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={`Add to ${name}`}
          className="h-6 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
          disabled={maxEntries !== undefined && rows.length >= maxEntries}
          onClick={add}
        >
          + Add value
        </button>
        {maxEntries !== undefined && (
          <span
            role="status"
            aria-label={`${name} count`}
            className="font-mono text-xs text-muted-foreground tabular-nums"
          >
            {count} / {maxEntries}
          </span>
        )}
      </div>
    </div>
  );
}
