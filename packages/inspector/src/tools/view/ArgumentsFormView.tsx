import { useCallback, useId, type ComponentType } from "react";
import { XIcon } from "lucide-react";

import type { JsonValue } from "@ayme-dev/ayme";

import type { ToolArguments } from "../../runs";
import { initialValues, type Field } from "../domain/fields";
import type { RefSource } from "../domain/refTree";
import type { ValueType } from "../domain/valueRows";

export const inputClass =
  // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
  "h-7.5 w-full min-w-0 rounded-md border border-input bg-background px-2.25 text-xs outline-none focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-ring";

type Change = (path: readonly string[], value: JsonValue | undefined) => void;

/** Whether the field at a path can be sent as it is. */
type Validity = (path: string, valid: boolean) => void;

const alwaysValid: Validity = () => {};

const noRefs: RefSource = { roots: [] };

/** A control the form takes for a field kind it doesn't render itself. */
type ControlProps = {
  id?: string;
  "aria-label": string;
  className?: string;
  value: string;
  onChange: (value: string | undefined) => void;
};

/** The controls of a ref field, a key field, a map of values, and a value typed as JSON. */
export type FieldControls = {
  map: ComponentType<{
    name: string;
    valueTypes: readonly ValueType[];
    optional: boolean;
    description?: string;
    maxEntries?: number;
    value: JsonValue | undefined;
    onChange: (value: JsonValue | undefined) => void;
    onValidity: (valid: boolean) => void;
  }>;
  ref: ComponentType<ControlProps & { source: RefSource }>;
  key: ComponentType<ControlProps>;
  json: ComponentType<{
    id?: string;
    "aria-label": string;
    className: string;
    value: JsonValue | undefined;
    onChange: (value: JsonValue | undefined) => void;
  }>;
};

/** The typed form: one control per field, editing the arguments in place. */
export function ArgumentsFormView({
  fields,
  values,
  onChange,
  refSource = noRefs,
  controls,
  onValidity = alwaysValid,
}: {
  fields: readonly Field[];
  values: ToolArguments;
  onChange: Change;
  /** Reports a field that can't be sent as it is, such as a map with a bad row. */
  onValidity?: Validity;
  /** Where a ref field chooses its ref from. */
  refSource?: RefSource;
  controls: FieldControls;
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
          onValidity={onValidity}
          refSource={refSource}
          controls={controls}
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
      className="flex items-baseline gap-1.5 text-xs font-semibold"
    >
      {field.name}
      {field.typeLabel && (
        <span className="font-mono text-xs font-medium text-muted-foreground">
          {field.typeLabel}
        </span>
      )}
      {field.optional && (
        <span className="text-xs font-medium text-muted-foreground">
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
  onValidity,
  refSource,
  controls,
}: {
  field: Field;
  path: readonly string[];
  value: JsonValue | undefined;
  onChange: Change;
  onValidity: Validity;
  refSource: RefSource;
  controls: FieldControls;
}) {
  const id = useId();
  // The control's name: its path, e.g. "details.due".
  const name = path.join(".");
  const set = (next: JsonValue | undefined) => onChange(path, next);
  const reportValidity = useCallback(
    (valid: boolean) => onValidity(name, valid),
    [onValidity, name]
  );

  if (field.kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-xs font-semibold">
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
        <span className="font-mono text-xs font-medium text-muted-foreground">
          boolean
        </span>
      </label>
    );

  if (field.kind === "map") {
    const { map: MapControl } = controls;
    return (
      <div className="flex flex-col gap-1">
        <FieldLabel field={field} />
        <MapControl
          name={name}
          valueTypes={field.valueTypes}
          optional={field.optional}
          description={field.description}
          maxEntries={field.maxEntries}
          value={value}
          onChange={set}
          onValidity={reportValidity}
        />
      </div>
    );
  }

  if (field.kind === "object") {
    const on = value !== undefined && value !== null;
    const entries =
      on && typeof value === "object" && !Array.isArray(value) ? value : {};
    return (
      <fieldset className="m-0 flex flex-col gap-2 rounded-lg border px-2.5 pt-2 pb-2.5">
        {field.optional ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              aria-label={name}
              checked={on}
              onChange={() => set(on ? undefined : initialValues(field.fields))}
            />
            {field.name}
            <span className="font-mono text-xs font-medium text-muted-foreground">
              object
            </span>
            <span className="text-xs font-medium text-muted-foreground">
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
              onValidity={onValidity}
              refSource={refSource}
              controls={controls}
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
              controls={controls}
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
              className="grid size-7.5 flex-none place-items-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => setRows(rows.filter((_, at) => at !== index))}
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add to ${name}`}
          className="h-6 self-start rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
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
        refSource={refSource}
        controls={controls}
      />
    </div>
  );
}

/** The control of a single value: text, a ref, a key, a number, a choice or JSON. */
function ScalarControl({
  field,
  id,
  name,
  value,
  onChange,
  refSource = noRefs,
  controls: { ref: RefField, key: KeyField, json: JsonControl },
}: {
  field: Field;
  id?: string;
  name: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  refSource?: RefSource;
  controls: FieldControls;
}) {
  const shared = { id, "aria-label": name, className: inputClass };
  switch (field.kind) {
    case "ref":
      return (
        <RefField
          {...shared}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          source={refSource}
        />
      );
    case "key":
      return (
        <KeyField
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
