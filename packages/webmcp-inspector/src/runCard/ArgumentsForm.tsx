import { useId, useState } from "react";
import { XIcon } from "lucide-react";

import type { JsonValue } from "@ayme-dev/webmcp";

import type { ToolArguments } from "../adapter/useRuns";
import { initialValues, type Field } from "./fields";
import { RefField } from "./RefField";

export const inputClass =
  "h-[30px] w-full min-w-0 rounded-md border border-input bg-background px-[9px] text-[12.5px] outline-none focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-ring";

type Change = (path: readonly string[], value: JsonValue | undefined) => void;

/** The typed form: one control per field, editing the arguments in place. */
export function ArgumentsForm({
  fields,
  values,
  onChange,
}: {
  fields: readonly Field[];
  values: ToolArguments;
  onChange: Change;
}) {
  return (
    <>
      {fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          path={[field.name]}
          value={values[field.name]}
          onChange={onChange}
        />
      ))}
    </>
  );
}

function FieldLabel({ field, htmlFor }: { field: Field; htmlFor?: string }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <Tag
      htmlFor={htmlFor}
      className="flex items-baseline gap-1.5 text-[11.5px] font-semibold"
    >
      {field.name}
      <span className="font-mono text-[11px] font-medium text-muted-foreground">
        {field.typeLabel}
      </span>
      {field.optional && (
        <span className="text-[11px] font-medium text-muted-foreground">
          optional
        </span>
      )}
    </Tag>
  );
}

function FieldRow({
  field,
  path,
  value,
  onChange,
}: {
  field: Field;
  path: readonly string[];
  value: JsonValue | undefined;
  onChange: Change;
}) {
  const id = useId();
  // The control's name: its path, e.g. "details.due".
  const name = path.join(".");
  const set = (next: JsonValue | undefined) => onChange(path, next);

  if (field.kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-[11.5px] font-semibold">
        <input
          type="checkbox"
          aria-label={name}
          checked={value === true}
          onChange={(event) =>
            set(
              event.target.checked || !field.optional
                ? event.target.checked
                : undefined
            )
          }
        />
        {field.name}
        <span className="font-mono text-[11px] font-medium text-muted-foreground">
          boolean
        </span>
      </label>
    );

  if (field.kind === "object") {
    const on = value !== undefined && value !== null;
    const entries =
      on && typeof value === "object" && !Array.isArray(value) ? value : {};
    return (
      <fieldset className="m-0 flex flex-col gap-2 rounded-lg border px-2.5 pt-2 pb-2.5">
        {field.optional ? (
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-semibold">
            <input
              type="checkbox"
              aria-label={name}
              checked={on}
              onChange={() => set(on ? undefined : initialValues(field.fields))}
            />
            {field.name}
            <span className="font-mono text-[11px] font-medium text-muted-foreground">
              object
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              optional
            </span>
          </label>
        ) : (
          <legend className="contents">
            <FieldLabel field={field} />
          </legend>
        )}
        {(on || !field.optional) &&
          field.fields.map((child) => (
            <FieldRow
              key={child.name}
              field={child}
              path={[...path, child.name]}
              value={entries[child.name]}
              onChange={onChange}
            />
          ))}
      </fieldset>
    );
  }

  if (field.kind === "list") {
    const rows = Array.isArray(value) ? value : [];
    const setRows = (next: JsonValue[]) =>
      set(next.length || !field.optional ? next : undefined);
    return (
      <div className="flex flex-col gap-1">
        <FieldLabel field={field} />
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <ScalarControl
              field={field.item}
              name={`${name} ${index + 1}`}
              value={row}
              onChange={(next) =>
                setRows(
                  rows.map((current, at) =>
                    at === index ? (next ?? "") : current
                  )
                )
              }
            />
            <button
              type="button"
              aria-label={`Remove ${name} ${index + 1}`}
              className="grid size-[30px] flex-none place-items-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => setRows(rows.filter((_, at) => at !== index))}
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add to ${name}`}
          className="h-6 self-start rounded-md border border-dashed px-2 text-[11.5px] text-muted-foreground hover:border-ring hover:text-foreground"
          onClick={() =>
            setRows([
              ...rows,
              field.item.kind === "choice" ? (field.item.options[0] ?? "") : "",
            ])
          }
        >
          + Add
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel field={field} htmlFor={id} />
      <ScalarControl
        field={field}
        id={id}
        name={name}
        value={value}
        onChange={set}
      />
    </div>
  );
}

/** The control of a single value: text, a ref, a number, a choice or JSON. */
function ScalarControl({
  field,
  id,
  name,
  value,
  onChange,
}: {
  field: Field;
  id?: string;
  name: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const shared = { id, "aria-label": name, className: inputClass };
  switch (field.kind) {
    case "ref":
      return (
        <RefField
          {...shared}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <input
          {...shared}
          type={field.inputType}
          value={typeof value === "string" ? value : ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" && field.optional
                ? undefined
                : event.target.value
            )
          }
        />
      );
    case "number":
      return (
        <input
          {...shared}
          type="number"
          step={field.integer ? 1 : "any"}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? undefined : Number(event.target.value)
            )
          }
        />
      );
    case "choice": {
      const index = field.options.findIndex((option) => option === value);
      return (
        <select
          {...shared}
          value={index === -1 ? "" : String(index)}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : field.options[Number(event.target.value)]
            )
          }
        >
          {(field.optional || index === -1) && <option value="">—</option>}
          {field.options.map((option, at) => (
            <option key={at} value={String(at)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <JsonControl {...shared} value={value} onChange={onChange} />;
  }
}

/** A value the form has no control for, typed as JSON. */
function JsonControl({
  value,
  onChange,
  ...props
}: {
  id?: string;
  "aria-label": string;
  className: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const [draft, setDraft] = useState(() =>
    value === undefined ? "" : JSON.stringify(value)
  );
  const [error, setError] = useState<string>();
  return (
    <>
      <textarea
        {...props}
        rows={2}
        spellCheck={false}
        className={`${props.className} h-auto py-1.5 font-mono`}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") {
            setError(undefined);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text) as JsonValue);
            setError(undefined);
          } catch {
            // Sent as typed: the tool's own validation reports it.
            onChange(text);
            setError(`${props["aria-label"]}: invalid JSON.`);
          }
        }}
      />
      {error && <span className="text-[11.5px] text-destructive">{error}</span>}
    </>
  );
}
