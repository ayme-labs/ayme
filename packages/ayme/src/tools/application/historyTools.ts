// The `navigate_back`, `navigate_forward` and `reload` Browser Tools: move the
// page through its history or reload it through the browser Page's `goBack`,
// `goForward` and `reload`, mirroring Playwright MCP's `browser_navigate_back`,
// `browser_navigate_forward` and `browser_reload`.
import type { JsonSchema } from "../../shared";
import type { PublishedElementTool } from "./elementTools";

const noInputSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/**
 * A tool that moves one history entry `back` or `forward`. Like any action,
 * the call answers with the Change Record once the page settles, or at once
 * when the entry is another document and its load starts. With no entry to
 * move to, the browser Page does not move the page and the call's `result`
 * says so. A traversal's answer follows the document's navigation, never
 * how the browser Page's own promise settles.
 */
function traversalTool(
  name: string,
  description: string,
  direction: "back" | "forward"
): PublishedElementTool {
  const tool: PublishedElementTool = {
    name,
    description,
    inputSchema: noInputSchema,
    execute: async (input, context) => {
      const { cursor, page, navigation } = context;
      const traverse = () =>
        direction === "back" ? page.goBack() : page.goForward();
      return context.pageStateSession.runAction(
        cursor,
        { tool: name, args: input },
        async () => {
          if (!(await navigation.traverse(traverse)))
            return `There is no history entry to go ${direction} to; the page did not move.`;
        }
      );
    },
  };
  return tool;
}

export const navigateBackTool = traversalTool(
  "navigate_back",
  "Go back to the previous page in the history.",
  "back"
);

export const navigateForwardTool = traversalTool(
  "navigate_forward",
  "Go forward to the next page in the history.",
  "forward"
);

/**
 * Reload the current page. A reload loads the document anew, so the call
 * answers at once as the load starts, unless a router takes it over and the
 * page stays.
 */
export const reloadTool: PublishedElementTool = {
  name: "reload",
  description: "Reload the current page.",
  inputSchema: noInputSchema,
  execute: async (input, context) => {
    const { cursor, page, navigation } = context;
    return context.pageStateSession.runAction(
      cursor,
      { tool: "reload", args: input },
      () => navigation.start(() => page.reload())
    );
  },
};
