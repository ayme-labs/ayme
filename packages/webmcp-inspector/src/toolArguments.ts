import type {
  JsonSchema,
  JsonValue,
  RegisteredPomTool,
  ToolParameter,
} from "@ayme-dev/webmcp";

export type ToolArguments = Record<string, JsonValue>;

/**
 * What a form field holds while the user edits it: the index of the chosen
 * option for an enum, the checked state for a boolean, the raw text otherwise.
 */
export type FieldValue = string | boolean;
export type FieldValues = Record<string, FieldValue>;

export type FieldKind = "enum" | "number" | "boolean" | "string" | "json";

export function fieldKind(schema: JsonSchema): FieldKind {
  if (schema.enum?.length) return "enum";
  switch (schema.type) {
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    default:
      return "json";
  }
}

export function initialFieldValue(parameter: ToolParameter): FieldValue {
  const { schema } = parameter;
  switch (fieldKind(schema)) {
    case "enum":
      return "0";
    case "number":
      return parameter.optional ? "" : "0";
    case "boolean":
      return false;
    case "string":
      return "";
    case "json":
      if (schema.type === "object") return "{}";
      if (schema.type === "array") return "[]";
      return "";
  }
}

export function fieldValue(
  values: FieldValues | undefined,
  parameter: ToolParameter
): FieldValue {
  return values?.[parameter.name] ?? initialFieldValue(parameter);
}

export type ArgumentsResult =
  { ok: true; arguments: ToolArguments } | { ok: false; error: string };

/**
 * Turns the form's field values into tool arguments. An optional field left
 * empty is omitted.
 */
export function toolArguments(
  tool: RegisteredPomTool,
  values: FieldValues | undefined
): ArgumentsResult {
  const args: ToolArguments = {};
  for (const parameter of tool.parameters) {
    const { name, optional, schema } = parameter;
    const value = fieldValue(values, parameter);
    const kind = fieldKind(schema);

    if (kind === "boolean") {
      args[name] = value === true;
      continue;
    }
    const text = String(value);
    if (kind === "enum") {
      const option = schema.enum?.[Number(text)];
      if (option === undefined)
        return { ok: false, error: `${name}: choose an option.` };
      args[name] = option;
      continue;
    }
    if (optional && (kind === "string" ? text : text.trim()) === "") continue;

    if (kind === "string") {
      args[name] = text;
    } else if (kind === "number") {
      const number = Number(text);
      if (text.trim() === "" || !Number.isFinite(number))
        return { ok: false, error: `${name}: enter a number.` };
      if (schema.type === "integer" && !Number.isInteger(number))
        return { ok: false, error: `${name}: enter a whole number.` };
      args[name] = number;
    } else {
      try {
        args[name] = JSON.parse(text) as JsonValue;
      } catch {
        return { ok: false, error: `${name}: enter valid JSON.` };
      }
    }
  }
  return { ok: true, arguments: args };
}
