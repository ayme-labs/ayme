import type { JsonPrimitive, JsonSchema, JsonValue } from "@ayme-dev/webmcp";

import type { ToolArguments } from "../adapter/useRuns";

/** A JSON Schema as the form reads it: the runtime's, with a string's format. */
type Schema = JsonSchema & { format?: string };

/** An input type for a string, by its format. */
export type TextInputType = "text" | "date" | "email" | "url";

/** One field of the typed form, built from a property of the tool's schema. */
export type Field = {
  name: string;
  optional: boolean;
  /** What it takes, shown beside its name, e.g. "date", "integer" or "low | high". */
  typeLabel: string;
} & FieldKind;

export type FieldKind =
  | { kind: "text"; inputType: TextInputType }
  /** A Structural Ref, e.g. e12, chosen from the page structure or on the page. */
  | { kind: "ref" }
  | { kind: "number"; integer: boolean }
  | { kind: "boolean" }
  | { kind: "choice"; options: readonly JsonPrimitive[] }
  /** A list of text, numbers or choices, one row per entry. */
  | { kind: "list"; item: Field }
  | { kind: "object"; fields: readonly Field[] }
  /** Anything the form has no control for, edited as JSON. */
  | { kind: "json" };

const inputTypes: Partial<Record<string, TextInputType>> = {
  date: "date",
  email: "email",
  uri: "url",
  url: "url",
};

/** The fields of an object schema, one per property, in schema order. */
export function fieldsOf(schema: JsonSchema): Field[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) =>
    fieldOf(name, property, !required.has(name))
  );
}

function fieldOf(name: string, schema: Schema, optional: boolean): Field {
  const base = { name, optional };
  if (schema.enum?.length)
    return {
      ...base,
      kind: "choice",
      options: schema.enum,
      typeLabel: schema.enum.map(String).join(" | "),
    };
  switch (schema.type) {
    case "string":
      if (name === "ref") return { ...base, kind: "ref", typeLabel: "ref" };
      return {
        ...base,
        kind: "text",
        inputType: inputTypes[schema.format ?? ""] ?? "text",
        typeLabel: schema.format ?? "string",
      };
    case "integer":
    case "number":
      return {
        ...base,
        kind: "number",
        integer: schema.type === "integer",
        typeLabel: schema.type,
      };
    case "boolean":
      return { ...base, kind: "boolean", typeLabel: "boolean" };
    case "array": {
      const item = schema.items && fieldOf(`${name} item`, schema.items, false);
      if (item && ["text", "number", "choice"].includes(item.kind))
        return {
          ...base,
          kind: "list",
          item,
          typeLabel: `${item.typeLabel}[]`,
        };
      break;
    }
    case "object":
      if (schema.properties)
        return {
          ...base,
          kind: "object",
          fields: fieldsOf(schema),
          typeLabel: "object",
        };
  }
  return { ...base, kind: "json", typeLabel: schema.type ?? "JSON" };
}

/**
 * The arguments a form starts from: the first choice of a required choice,
 * false for a required boolean, an empty list, and required objects filled
 * the same way. Everything else starts empty.
 */
export function initialArguments(schema: JsonSchema): ToolArguments {
  return initialValues(fieldsOf(schema));
}

/** The values fields start from, as {@link initialArguments} describes. */
export function initialValues(fields: readonly Field[]): ToolArguments {
  return Object.fromEntries(
    fields.flatMap((field): [string, JsonValue][] => {
      if (field.optional) return [];
      switch (field.kind) {
        case "choice":
          return field.options.length ? [[field.name, field.options[0]!]] : [];
        case "boolean":
          return [[field.name, false]];
        case "list":
          return [[field.name, []]];
        case "object":
          return [[field.name, initialValues(field.fields)]];
        default:
          return [];
      }
    })
  );
}

/** The arguments with the value at a path set, or removed when undefined. */
export function withArgument(
  args: ToolArguments,
  path: readonly string[],
  value: JsonValue | undefined
): ToolArguments {
  const [name, ...rest] = path;
  if (name === undefined) return args;
  const next = { ...args };
  const nested = rest.length
    ? withArgument(asObject(args[name]), rest, value)
    : value;
  if (nested === undefined) delete next[name];
  else next[name] = nested;
  return next;
}

function asObject(value: JsonValue | undefined): ToolArguments {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/** The arguments as the JSON editor shows them. */
export function argumentsToJson(args: ToolArguments) {
  return JSON.stringify(args, null, 2);
}

export type ParsedArguments =
  { ok: true; arguments: ToolArguments } | { ok: false; error: string };

/** The arguments typed in the JSON editor, or why they can't be used. */
export function argumentsFromJson(text: string): ParsedArguments {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "Arguments must be a JSON object." };
  return { ok: true, arguments: value as ToolArguments };
}

/** An action's signature from its schema, e.g. "(text, details?)". */
export function signatureOf(schema: JsonSchema) {
  const names = fieldsOf(schema).map(
    (field) => `${field.name}${field.optional ? "?" : ""}`
  );
  return `(${names.join(", ")})`;
}
