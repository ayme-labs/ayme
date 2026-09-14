import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { JsonValue, PomDefinition } from "./contracts";
import {
  getPageStateForDocument,
  type AriaRef,
  type PageState,
} from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { renderPomDefinitions } from "./pomDefinitionText";

type GetPageContextInput = { names?: string[] };

export type PageContext = {
  readonly structure: string;
  readonly pomDefinitions: readonly PomDefinition[];
  resolve(...refs: AriaRef[]): ReturnType<PageState["resolve"]>;
};

export type PageContextPayload = {
  readonly structure: string;
  readonly pomDefinitions: string;
};

export const getPageContextTool = {
  name: "get_page_context",
  description:
    "Return the current structural page state together with compact POM definitions. A bare member is a Locator; member: ChildPom is a child POM; [] marks collections; and action(args): this | OtherPom is an action with possible next POMs. Action comments are authored descriptions, and this means the current POM. Definitions can include referenced POMs that are not currently visible; registered tool schemas remain authoritative.",
  inputSchema: {
    type: "object",
    properties: {
      names: { type: "array", items: { type: "string" } },
    },
    required: [],
    additionalProperties: false,
  } as const,
  execute: async (input: unknown): Promise<JsonValue> => {
    const context = await getPageContextForDocument(
      document,
      ...definitionNamesFrom(input)
    );
    const payload: PageContextPayload = {
      structure: context.structure,
      pomDefinitions: renderPomDefinitions(context.pomDefinitions),
    };
    return JSON.parse(JSON.stringify(payload)) as JsonValue;
  },
} satisfies ModelContextTool<GetPageContextInput, JsonValue>;

export async function getPageContextForDocument(
  currentDocument: Document,
  ...names: readonly string[]
): Promise<PageContext> {
  const pageState = await getPageStateForDocument(currentDocument);
  return Object.freeze({
    structure: pageState.text,
    pomDefinitions: getPomDefinitions(...names).definitions,
    resolve: pageState.resolve,
  });
}

function definitionNamesFrom(input: unknown): string[] {
  if (input === undefined || input === null || typeof input !== "object")
    return [];
  if (!("names" in input) || input.names === undefined) return [];
  if (!Array.isArray(input.names))
    throw new Error("POM definition names must be an array.");
  if (!input.names.every((name) => typeof name === "string"))
    throw new Error("POM definition names must be strings.");
  return input.names;
}
