import type { ToolDescriptor } from "../../shared";
import type { RunContext } from "../../runs/application";

/**
 * `page_objects`: the Page Object Tree of the Run's page, as text. A read:
 * it moves no cursor and adds no settle wait.
 */
export const pageObjectsTool = {
  name: "page_objects",
  description:
    "Returns the Page Objects on the page now as a tree: each one's class, its declared children with their values, and the id (po<n>) of each one that has a root.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  } as const,
  execute: (_input: unknown, context: RunContext) => context.pageObjectTree(),
} satisfies ToolDescriptor & {
  inputSchema: object;
  execute(input: unknown, context: RunContext): Promise<string>;
};
