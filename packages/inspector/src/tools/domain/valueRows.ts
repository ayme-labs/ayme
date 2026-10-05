import type { JsonSchema, JsonValue } from "@ayme-dev/ayme";

/**
 * A map of labelled values, such as `goal`'s `values`, edited as rows: a
 * label, a value typed as text, and the type it is sent as.
 */

export type ValueType = "string" | "number";

export type ValueRow = {
  label: string;
  /** As typed. */
  value: string;
  /** The type the person fixed; null while it is guessed from the value. */
  fixed: ValueType | null;
};

/** A plain JSON number, e.g. 2, -3 or 2.5. "02134", "+3" and "1e3" are not. */
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * The value types a map schema takes, when its values are strings and/or
 * numbers under any label; undefined for any other schema.
 */
export function mapValueTypes(schema: JsonSchema): ValueType[] | undefined {
  const values = schema.additionalProperties;
  if (schema.properties || typeof values !== "object") return undefined;
  const types = new Set<ValueType>();
  for (const variant of values.anyOf ?? [values]) {
    if (variant.enum) return undefined;
    if (variant.type === "string") types.add("string");
    else if (variant.type === "number" || variant.type === "integer")
      types.add("number");
    else return undefined;
  }
  return types.size ? [...types] : undefined;
}

/** The type a value is guessed to be: a number when it reads as one. */
export function guessedType(
  value: string,
  types: readonly ValueType[]
): ValueType {
  if (types.length === 1) return types[0]!;
  return NUMBER.test(value.trim()) ? "number" : "string";
}

/** The type a row is sent as. */
export function typeOf(row: ValueRow, types: readonly ValueType[]): ValueType {
  return row.fixed ?? guessedType(row.value, types);
}

/** The type a click on the row's type fixes: the other one. */
export function otherType(
  row: ValueRow,
  types: readonly ValueType[]
): ValueType {
  return typeOf(row, types) === "number" ? "string" : "number";
}

/**
 * The rows of a map, in its order. A value whose type the guess would get
 * wrong, such as the string "7", comes back fixed to its own type.
 */
export function rowsOf(
  value: JsonValue | undefined,
  types: readonly ValueType[]
): ValueRow[] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [];
  return Object.entries(value).map(([label, entry]) => {
    const text = String(entry);
    const type: ValueType = typeof entry === "number" ? "number" : "string";
    return {
      label,
      value: text,
      fixed: guessedType(text, types) === type ? null : type,
    };
  });
}

export type ReadRows = {
  /** The map the rows make, without the rows that have a problem. */
  values: Record<string, string | number>;
  /** Per row: what is wrong with it, if anything. */
  problems: (string | undefined)[];
};

/** Read the rows as a map. A row with neither label nor value is skipped. */
export function readRows(
  rows: readonly ValueRow[],
  types: readonly ValueType[]
): ReadRows {
  const seen = new Set<string>();
  const entries: [string, string | number][] = [];
  const problems = rows.map((row) => {
    const label = row.label.trim();
    if (label === "" && row.value === "") return undefined;
    if (label === "")
      return "Add a label so the loop can tell this value apart.";
    if (seen.has(label))
      return `"${label}" is already used. Each label must be different.`;
    seen.add(label);
    if (typeOf(row, types) === "number") {
      if (!NUMBER.test(row.value.trim()))
        return row.value === ""
          ? "Enter a number, such as 2 or 2.5."
          : `"${row.value}" is not a number. Enter one such as 2 or 2.5${types.includes("string") ? ", or switch the type to text" : ""}.`;
      entries.push([label, Number(row.value.trim())]);
    } else entries.push([label, row.value]);
    return undefined;
  });
  // From entries, never by assignment: a label may be any string.
  return { values: Object.fromEntries(entries), problems };
}
