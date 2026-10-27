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

/** A tool as `describeTool` reads it. */
type DescribedTool = {
  name: string;
  description?: string;
  returnPoms?: readonly string[];
};

/** Who reads a tool's description. */
export type DescriptionReader =
  "ayme-mcp" | "webmcp" | "goal-loop" | "inspector";

/**
 * Whether a reader needs a description of every tool. WebMCP refuses a tool
 * without one, and the Goal Loop's model chooses an operation by it. Ayme
 * MCP allows none, and the Inspector shows what Ayme MCP gives agents.
 */
const descriptionRequired = {
  "ayme-mcp": false,
  webmcp: true,
  "goal-loop": true,
  inspector: false,
} as const satisfies Record<DescriptionReader, boolean>;

/**
 * A tool's description as `reader` reads it: its own, then the Page Objects
 * the page shows afterwards, by class. When the tool says nothing beyond its
 * name and schema, a reader that requires a description gets `Run addItem.`
 * and the others get none. A Browser or Custom Tool's description is its own.
 */
export function describeTool(
  tool: DescribedTool,
  reader: "webmcp" | "goal-loop"
): string;
export function describeTool(
  tool: DescribedTool,
  reader: "ayme-mcp" | "inspector"
): string | undefined;
export function describeTool(
  tool: DescribedTool,
  reader: DescriptionReader
): string | undefined;
export function describeTool(
  tool: DescribedTool,
  reader: DescriptionReader
): string | undefined {
  const parts = tool.description === undefined ? [] : [tool.description];
  if (tool.returnPoms?.length)
    parts.push(`Then shows ${tool.returnPoms.join(" or ")}.`);
  if (parts.length) return parts.join(" ");
  if (descriptionRequired[reader])
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
