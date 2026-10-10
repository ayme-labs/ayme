import type { JsonSchema, ToolManifest, ToolParameter } from "./contracts";

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

/** An action's description as agents read it. */
export function toolDescription(tool: ToolManifest) {
  const parts = [tool.description ?? `Run ${tool.methodName}.`];
  const rest = tool.parameters.find((parameter) => parameter.rest);
  if (rest)
    parts.push(
      `${rest.name} is a rest parameter: pass its arguments as a list.`
    );
  if (tool.returnPoms?.length)
    parts.push(`Potential return POMs: ${tool.returnPoms.join(", ")}.`);
  return parts.join(" ");
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
