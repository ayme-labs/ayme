import type { JsonSchema, RegisteredPomTool } from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";

/** A tool as the run card runs it. */
export type RunnableTool = {
  name: string;
  /** The action's own name, e.g. addItem; a tool's name when it's no action. */
  action: string;
  description: string;
  /**
   * The arguments a person fills in: the tool's input, or for a collection
   * action the action's own arguments, without the item's ref.
   */
  argumentsSchema: JsonSchema;
  /**
   * For a collection action, where its items are, e.g. "ListPage.items[]".
   * Its input is then `{ ref, args }`: the item's ref and its arguments.
   */
  collection?: string;
  /** Whether it can be called now: WebMCP publishes it. */
  available: boolean;
};

/** A tool that isn't a Page Object's action, such as get_page_context. */
export type OtherTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

/**
 * The built-in Ref tools, which the Inspector runs through the public `ayme`
 * API. The runtime doesn't list them to the Inspector yet (#181 does), so
 * their input is written here the way the runtime declares it.
 */
export const builtInRefTools: readonly OtherTool[] = [
  {
    name: "click_page_state_ref",
    description:
      "Click a real element ref from get_page_context. The ref is resolved against a fresh capture before the action.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "fill_page_state_ref",
    description:
      "Fill a real editable element ref from get_page_context with text. The ref is resolved against a fresh capture before the action.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
    },
  },
];

/**
 * Every registered Page Object tool once by name, and the other tools the
 * panel can run, as the run card runs them.
 */
export function listRunnableTools(
  registeredPoms: readonly RegisteredPom[],
  activeTools: ReadonlyMap<string, unknown>,
  otherTools: readonly OtherTool[]
): ReadonlyMap<string, RunnableTool> {
  const tools = new Map<string, RunnableTool>();
  for (const registration of registeredPoms)
    for (const tool of registration.tools)
      if (!tools.has(tool.name))
        tools.set(tool.name, pageObjectTool(tool, activeTools.has(tool.name)));
  for (const tool of otherTools)
    if (!tools.has(tool.name))
      tools.set(tool.name, {
        name: tool.name,
        action: tool.name,
        description: tool.description,
        argumentsSchema: tool.inputSchema,
        available: true,
      });
  return tools;
}

function pageObjectTool(
  tool: RegisteredPomTool & { componentPath?: string },
  available: boolean
): RunnableTool {
  const collection = innermostCollectionPath(tool.componentPath);
  const base = {
    name: tool.name,
    action: tool.methodName,
    description: tool.description,
    available,
  };
  if (collection === undefined)
    return { ...base, argumentsSchema: schemaOf(tool.parameters) };
  // A collection action takes { ref, args }; the item picker gives the ref.
  const args = tool.parameters.find((parameter) => parameter.name === "args");
  return {
    ...base,
    argumentsSchema: args?.schema ?? { type: "object" },
    collection: `${tool.pomId}.${collection}`,
  };
}

/** An object schema of a tool's parameters, as the runtime validates them. */
function schemaOf(parameters: RegisteredPomTool["parameters"]): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      parameters.map((parameter) => [parameter.name, parameter.schema])
    ),
    required: parameters
      .filter((parameter) => !parameter.optional)
      .map((parameter) => parameter.name),
  };
}

/**
 * The path of the items a collection action runs on: everything up to and
 * including the last collection segment, e.g. "items[]" for "items[].tags".
 */
function innermostCollectionPath(componentPath: string | undefined) {
  if (componentPath === undefined) return undefined;
  const segments = componentPath.split(".");
  const last = segments.findLastIndex((segment) => segment.endsWith("[]"));
  return last === -1 ? undefined : segments.slice(0, last + 1).join(".");
}
