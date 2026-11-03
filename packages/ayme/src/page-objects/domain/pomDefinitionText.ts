import type {
  JsonSchema,
  PomDefinition,
  PomDefinitionAction,
  ToolParameter,
} from "../../shared";
import {
  inputParameters,
  typeRequires,
  type InputParameter,
} from "./actionTool";

export function renderPomDefinitions(
  definitions: readonly PomDefinition[]
): string {
  return definitions.map(renderPomDefinition).join("\n\n");
}

function renderPomDefinition(definition: PomDefinition): string {
  const lines = [
    `${definition.name}${
      definition.description ? ` // ${definition.description}` : ""
    }`,
  ];

  for (const child of definition.children) {
    lines.push(`  ${renderChild(child)}`);
  }

  if (definition.children.length > 0 && definition.actions.length > 0)
    lines.push("");

  for (const [index, action] of definition.actions.entries()) {
    if (index > 0) lines.push("");
    if (action.description) lines.push(`  // ${action.description}`);
    lines.push(`  ${renderAction(action, definition.name)}`);
  }

  return lines.join("\n");
}

function renderChild(child: PomDefinition["children"][number]): string {
  const brackets = child.collection ? "[]" : "";
  const declaration =
    child.kind === "locator"
      ? `${child.memberName}${brackets}`
      : `${child.memberName}: ${child.componentClassName}${brackets}`;
  return child.description
    ? `${declaration} // ${child.description}`
    : declaration;
}

function renderAction(action: PomDefinitionAction, ownerName: string): string {
  const parameters = renderActionParameters(action.parameters);
  const returnPoms = action.returnPoms.map((name) =>
    name === ownerName ? "this" : name
  );
  const returnType = returnPoms.length > 0 ? `: ${returnPoms.join(" | ")}` : "";
  return `${action.name}(${parameters})${returnType}`;
}

/**
 * Package-internal: an action's parameter list, e.g. `name: string, tags?:
 * string[]`, the way the definition text writes it: from the parameters it
 * declares, a destructured one in the shape of its pattern, e.g. `{ email:
 * string }` or `[x: number, y: number]`, or from a tool's input schema.
 */
export function renderActionParameters(
  input: JsonSchema | readonly ToolParameter[]
): string {
  if (!isParameters(input)) return renderSchemaProperties(input, ", ");
  return input.map(renderParameter).join(", ");
}

function isParameters(
  input: JsonSchema | readonly ToolParameter[]
): input is readonly ToolParameter[] {
  return Array.isArray(input);
}

/**
 * A parameter as agents give it. A defaulted pattern is optional as a
 * whole, `{ email: string }?`, and its fields read as its type has them.
 */
function renderParameter(parameter: ToolParameter): string {
  if (!("destructured" in parameter))
    return renderField(inputParameters([parameter])[0]!);
  const fields = parameter.fields.map((field) => ({
    ...field,
    optional: !typeRequires(field),
  }));
  const shape =
    parameter.destructured === "object"
      ? fields.length
        ? `{ ${fields.map(renderField).join("; ")} }`
        : "{}"
      : `[${fields
          .map((field) =>
            field.rest
              ? `...${field.name}: ${renderSchema(field.schema)}`
              : renderField(field)
          )
          .join(", ")}]`;
  return `${parameter.rest ? "..." : ""}${shape}${parameter.optional ? "?" : ""}`;
}

function renderField({ name, optional, schema }: InputParameter): string {
  return `${name}${optional ? "?" : ""}: ${renderSchema(schema)}`;
}

/** Package-internal: a schema as a TypeScript type, e.g. `[number, string?]`. */
export function renderSchema(schema: JsonSchema): string {
  if (schema.enum && schema.enum.length > 0)
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(renderSchema).join(" | ");
  if (schema.type === "array") return renderArray(schema);
  if (schema.type === "object") {
    const members = [renderSchemaProperties(schema, "; ")];
    if (typeof schema.additionalProperties === "object")
      members.push(
        `[key: string]: ${renderSchema(schema.additionalProperties)}`
      );
    const body = members.filter((member) => member.length > 0).join("; ");
    return body.length > 0 ? `{ ${body} }` : "object";
  }
  if (schema.type === "integer") return "number";
  return schema.type ?? "unknown";
}

function renderArray(schema: JsonSchema): string {
  if (!schema.prefixItems) {
    const item = renderSchema(schema.items ?? {});
    return schema.items?.anyOf || (schema.items?.enum?.length ?? 0) > 1
      ? `(${item})[]`
      : `${item}[]`;
  }
  const elements = schema.prefixItems.map(
    (item, index) =>
      `${renderSchema(item)}${index < (schema.minItems ?? 0) ? "" : "?"}`
  );
  if (schema.items) elements.push(`...${renderArray({ items: schema.items })}`);
  return `[${elements.join(", ")}]`;
}

function renderSchemaProperties(schema: JsonSchema, separator: string): string {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(
      ([name, property]) =>
        `${name}${required.has(name) ? "" : "?"}: ${renderSchema(property)}`
    )
    .join(separator);
}
