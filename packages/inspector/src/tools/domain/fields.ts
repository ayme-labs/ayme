import type { JsonPrimitive, JsonSchema, JsonValue } from "@ayme-dev/ayme";
import type { ToolParameter } from "@ayme-dev/ayme/internal";

import type { ToolArguments } from "../../runs";
import { jsonSyntaxError } from "./jsonSyntax";
import { mapValueTypes, type ValueType } from "./valueRows";

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
  /** A key or combo for press_key, e.g. ControlOrMeta+C, recorded or searched. */
  | { kind: "key" }
  | { kind: "number"; integer: boolean }
  | { kind: "boolean" }
  | { kind: "choice"; options: readonly JsonPrimitive[] }
  /** A list of text, numbers or choices, one row per entry. */
  | { kind: "list"; item: Field }
  | { kind: "object"; fields: readonly Field[] }
  /**
   * Values under labels the person chooses, such as `goal`'s `values`, one
   * row per value. `description` is the schema's, shown above the rows.
   */
  | {
      kind: "map";
      valueTypes: readonly ValueType[];
      maxEntries?: number;
      description?: string;
    }
  /** Anything the form has no control for, edited as JSON. */
  | { kind: "json" };

/**
 * A destructured parameter's fields, which the form shows together without
 * a label: each is an argument of its own, beside the other parameters'. A
 * defaulted pattern's group is optional as a whole: left out entirely, or
 * given with every field its type requires.
 */
export type FieldGroup = {
  kind: "group";
  optional?: true;
  fields: readonly Field[];
};

/**
 * How a schema reads as TypeScript, the way the definition text agents read
 * writes it: one type, e.g. `string | number`, and an action's signature,
 * e.g. `(text: string, tags?: string[])`, from its schema or from the
 * parameters it declares.
 */
export type SchemaText = {
  type: (schema: JsonSchema) => string;
  signature: (input: JsonSchema | readonly ToolParameter[]) => string;
};

const inputTypes: Partial<Record<string, TextInputType>> = {
  date: "date",
  email: "email",
  uri: "url",
  url: "url",
};

/**
 * The fields of an object schema, one per property, in schema order.
 * `ref` names the property that takes a Structural Ref, and `key` the one
 * that takes a key to press, if any. `typeOf` labels a field edited as JSON
 * with its type, e.g. `[number, string]`; without it, the label is the
 * schema's `type`.
 */
export function fieldsOf(
  schema: JsonSchema,
  {
    ref,
    key,
    typeOf,
  }: { ref?: string; key?: string; typeOf?: SchemaText["type"] } = {}
): Field[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const optional = !required.has(name);
    if (property.type === "string" && (name === ref || name === key)) {
      const kind = name === ref ? "ref" : "key";
      return { name, optional, kind, typeLabel: kind };
    }
    return fieldOf(name, property, optional, typeOf);
  });
}

/**
 * The fields in the shape of the parameters an action declares: each
 * destructured parameter's fields in one group. Without a destructured
 * parameter, the fields as they are.
 */
export function groupFields(
  fields: readonly Field[],
  parameters: readonly ToolParameter[] = []
): (Field | FieldGroup)[] {
  if (!parameters.some((parameter) => "destructured" in parameter))
    return [...fields];
  const byName = new Map(fields.map((field) => [field.name, field]));
  const fieldsNamed = (names: readonly { name: string }[]) =>
    names.flatMap(({ name }) => byName.get(name) ?? []);
  return parameters.flatMap((parameter): (Field | FieldGroup)[] => {
    if (!("destructured" in parameter)) return fieldsNamed([parameter]);
    if (!parameter.optional)
      return [{ kind: "group", fields: fieldsNamed(parameter.fields) }];
    // What the type requires: a rest element with no minimum may be empty.
    const required = new Set(
      parameter.fields
        .filter(
          (field) => !field.optional && !(field.rest && !field.schema.minItems)
        )
        .map(({ name }) => name)
    );
    return [
      {
        kind: "group",
        optional: true,
        fields: fieldsNamed(parameter.fields).map((field) => ({
          ...field,
          optional: !required.has(field.name),
        })),
      },
    ];
  });
}

function fieldOf(
  name: string,
  schema: Schema,
  optional: boolean,
  typeOf: SchemaText["type"] | undefined
): Field {
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
      // A tuple's fixed elements have their own types, so it is edited as JSON.
      const item =
        !schema.prefixItems &&
        schema.items &&
        fieldOf(`${name} item`, schema.items, false, typeOf);
      if (item && ["text", "number", "choice"].includes(item.kind))
        return {
          ...base,
          kind: "list",
          item,
          typeLabel: `${item.typeLabel}[]`,
        };
      break;
    }
    case "object": {
      if (schema.properties)
        return {
          ...base,
          kind: "object",
          fields: fieldsOf(schema, { typeOf }),
          typeLabel: "object",
        };
      const valueTypes = mapValueTypes(schema);
      if (valueTypes)
        return {
          ...base,
          kind: "map",
          valueTypes,
          ...(schema.maxProperties !== undefined
            ? { maxEntries: schema.maxProperties }
            : {}),
          ...(schema.description ? { description: schema.description } : {}),
          // The rows name their own columns.
          typeLabel: "",
        };
    }
  }
  return {
    ...base,
    kind: "json",
    typeLabel: typeOf?.(schema) ?? schema.type ?? "JSON",
  };
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
  | { ok: true; arguments: ToolArguments }
  | {
      ok: false;
      error: string;
      /** Where a syntax error is, 1-based. */
      position?: { line: number; column: number };
    };

/** The arguments typed in the JSON editor, or why they can't be used. */
export function argumentsFromJson(text: string): ParsedArguments {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const syntax = jsonSyntaxError(text);
    if (!syntax)
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    const { line, column, message } = syntax;
    return {
      ok: false,
      error: `Invalid JSON at line ${line}, column ${column}: ${message}.`,
      position: { line, column },
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "Arguments must be a JSON object." };
  return { ok: true, arguments: value as ToolArguments };
}

/**
 * An action's signature, written by `signature` from the parameters it
 * declares or else its schema, e.g. "(text: string, details?: { due: string
 * })", or none when it takes no arguments.
 */
export function signatureOf(
  schema: JsonSchema,
  signature: SchemaText["signature"],
  parameters?: readonly ToolParameter[]
) {
  return fieldsOf(schema).length ? signature(parameters ?? schema) : undefined;
}
