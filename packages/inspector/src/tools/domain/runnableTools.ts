import type { JsonSchema, RegisteredPomTool } from "@ayme-dev/ayme";
import type {
  PublishedToolGroup,
  RegisteredPom,
} from "@ayme-dev/ayme/internal";

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
  /**
   * Whether the session lists it: a Page Object action's Page Object is on
   * the page. Every other tool is present. An absent action has no Run.
   */
  present: boolean;
  /**
   * Whether a call would run it (ADR-0035): the session refuses a call on
   * an unavailable tool, with `reason` when it has one. Never true for an
   * absent tool.
   */
  available: boolean;
  /** Why it is unavailable: the runtime's finding, or the action's own word. */
  reason?: string;
  /**
   * The argument that takes a Structural Ref, for a tool that acts on one
   * element: a Custom Tool's `ref` or a Browser Tool's `target`. A Page
   * Object action's arguments never do, whatever their names.
   */
  refField?: "ref" | "target";
  /** The argument that takes a key to press: a Browser Tool's `key`. */
  keyField?: "key";
  /** Whether it's the `fill_form` Browser Tool, which has its own form. */
  fillForm?: true;
  /** Whether it's the `generate_locator` Browser Tool, which has its own form. */
  locatorGroups?: true;
};

/**
 * A tool the session lists as live: one whose Page Object or element is on
 * the page, available or not.
 */
export type ToolSummary = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  group?: PublishedToolGroup;
  available: boolean;
  reason?: string;
};

/**
 * Every registered Page Object tool once by name, and every other live tool,
 * such as Browser and Custom Tools and the agent's own tools, as the run card runs them,
 * whether or not WebMCP publishes them. A Page Object tool is present when
 * the session lists it, or the registry has it available; its availability
 * is the session's word.
 */
export function listRunnableTools(
  registeredPoms: readonly RegisteredPom[],
  activeTools: ReadonlyMap<string, unknown>,
  otherTools: readonly ToolSummary[]
): ReadonlyMap<string, RunnableTool> {
  const live = new Map(otherTools.map((tool) => [tool.name, tool]));
  const tools = new Map<string, RunnableTool>();
  for (const registration of registeredPoms)
    for (const tool of registration.tools)
      if (!tools.has(tool.name)) {
        const listed = live.get(tool.name);
        const active = activeTools.has(tool.name);
        tools.set(
          tool.name,
          pageObjectTool(
            tool,
            listed
              ? {
                  present: true,
                  available: listed.available,
                  reason: listed.reason,
                }
              : { present: active, available: active }
          )
        );
      }
  for (const tool of otherTools)
    if (!tools.has(tool.name)) {
      const refField = (["target", "ref"] as const).find(
        (name) => tool.inputSchema.properties?.[name]?.type === "string"
      );
      tools.set(tool.name, {
        name: tool.name,
        action: tool.name,
        description: tool.description,
        argumentsSchema: tool.inputSchema,
        present: true,
        available: tool.available,
        reason: tool.reason,
        ...(refField ? { refField } : {}),
        ...(tool.group === "browser" &&
        tool.inputSchema.properties?.key?.type === "string"
          ? { keyField: "key" as const }
          : {}),
        ...(tool.group === "browser" && tool.name === "fill_form"
          ? { fillForm: true as const }
          : {}),
        ...(tool.group === "browser" && tool.name === "generate_locator"
          ? { locatorGroups: true as const }
          : {}),
      });
    }
  return tools;
}

function pageObjectTool(
  tool: RegisteredPomTool & { componentPath?: string },
  availability: Pick<RunnableTool, "present" | "available" | "reason">
): RunnableTool {
  const collection = innermostCollectionPath(tool.componentPath);
  const base = {
    name: tool.name,
    action: tool.methodName,
    description: tool.description,
    ...availability,
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
