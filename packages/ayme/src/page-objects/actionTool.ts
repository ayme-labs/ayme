import type { JsonSchema, ToolManifest, ToolParameter } from "../shared";

/** A parameter as agents read it: whether they may leave it out, and its schema. */
export type InputParameter = {
  name: string;
  optional: boolean;
  schema: JsonSchema;
};

/**
 * An action's parameters as agents read them: a literal default sits in the
 * schema, and a rest parameter with no minimum may be left out.
 */
export function inputParameters(
  parameters: readonly ToolParameter[]
): InputParameter[] {
  return parameters.map((parameter) => ({
    name: parameter.name,
    optional:
      parameter.optional ||
      (parameter.rest === true && !parameter.schema.minItems),
    schema:
      parameter.default === undefined
        ? parameter.schema
        : { ...parameter.schema, default: parameter.default },
  }));
}

/** The object schema an action's arguments are validated against. */
export function inputSchemaFor(
  parameters: readonly ToolParameter[]
): JsonSchema {
  const input = inputParameters(parameters);
  return {
    type: "object",
    properties: Object.fromEntries(
      input.map((parameter) => [parameter.name, parameter.schema])
    ),
    required: input
      .filter((parameter) => !parameter.optional)
      .map((parameter) => parameter.name),
    additionalProperties: false,
  };
}

/**
 * What a Page Object Tool tells about its action beyond its name and schema:
 * the description its author wrote, and the other Page Objects it may
 * return, which the page shows afterwards. A blank description, or
 * returning its own class, tells nothing, so it is left out.
 */
export function actionFacts(
  action: ToolManifest,
  ownClassName: string
): { description?: string; returnPoms?: readonly string[] } {
  const returnPoms =
    action.returnPoms?.filter((name) => name !== ownClassName) ?? [];
  return {
    // A blank description says nothing, and WebMCP refuses an empty one.
    ...(action.description?.trim() ? { description: action.description } : {}),
    ...(returnPoms.length ? { returnPoms } : {}),
  };
}

/** A tool as `agentDescription` reads it. */
type DescribedTool = {
  name: string;
  description?: string;
  returnPoms?: readonly string[];
};

/**
 * A tool's description as agents read it: its own, then the Page Objects
 * the page shows afterwards. None when the tool says nothing beyond its name
 * and schema, unless `required`: WebMCP refuses a tool without one, and the
 * Goal Loop's model chooses an operation by it, so they get `Run addItem.`.
 */
export function agentDescription(
  tool: DescribedTool,
  options: { required: true }
): string;
export function agentDescription(
  tool: DescribedTool,
  options?: { required: boolean }
): string | undefined;
export function agentDescription(
  tool: DescribedTool,
  options?: { required: boolean }
): string | undefined {
  const parts = tool.description === undefined ? [] : [tool.description];
  if (tool.returnPoms?.length)
    parts.push(`Then shows ${tool.returnPoms.join(" or ")}.`);
  if (parts.length) return parts.join(" ");
  if (options?.required)
    return `Run ${tool.name.slice(tool.name.lastIndexOf(".") + 1)}.`;
  return undefined;
}

/** The method's arguments: a rest parameter's list is its remaining ones. */
export function methodArguments(
  parameters: readonly ToolParameter[],
  values: readonly unknown[]
): unknown[] {
  return parameters.flatMap((parameter, index) =>
    parameter.rest
      ? ((values[index] as unknown[] | undefined) ?? [])
      : [values[index]]
  );
}
