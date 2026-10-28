import type { JsonSchema, ToolManifest, ToolParameter } from "../../shared";

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
 * the description its author wrote, the other Page Objects it may return,
 * which the page shows afterwards, and its Agent Description, the text an
 * agent reads from the two. A blank description, or returning its own class,
 * tells nothing, so it is left out.
 */
export function actionFacts(
  action: ToolManifest,
  ownClassName: string
): {
  authorDescription?: string;
  agentDescription?: string;
  returnPoms?: readonly string[];
} {
  const returnPoms =
    action.returnPoms?.filter((name) => name !== ownClassName) ?? [];
  // A blank description says nothing, and WebMCP refuses an empty one.
  const authorDescription = action.description?.trim()
    ? action.description
    : undefined;
  const agentDescription = describeAction(authorDescription, returnPoms);
  return {
    ...(authorDescription === undefined ? {} : { authorDescription }),
    ...(agentDescription === undefined ? {} : { agentDescription }),
    ...(returnPoms.length ? { returnPoms } : {}),
  };
}

/**
 * The author's description, then the Page Objects the page shows
 * afterwards, by class: `Shows A or B.` alone, `Then shows A or B.` after
 * the author's text. None when the action says nothing beyond its name and
 * schema.
 */
function describeAction(
  authorDescription: string | undefined,
  returnPoms: readonly string[]
): string | undefined {
  if (!returnPoms.length) return authorDescription;
  const shown = returnPoms.join(" or ");
  return authorDescription === undefined
    ? `Shows ${shown}.`
    : `${authorDescription} Then shows ${shown}.`;
}

/**
 * A tool's description for a reader that needs one of every tool: its Agent
 * Description, or `Run addItem.` when it has none. WebMCP refuses a tool
 * without a description, and the Goal Loop's model chooses an operation by
 * it.
 */
export function requiredDescription(tool: {
  name: string;
  agentDescription?: string;
}): string {
  return (
    tool.agentDescription ??
    `Run ${tool.name.slice(tool.name.lastIndexOf(".") + 1)}.`
  );
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
