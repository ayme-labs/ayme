// The `navigate_back`, `navigate_forward` and `reload` Browser Tools: move the
// page through its history or reload it through the browser Page's `goBack`,
// `goForward` and `reload`, mirroring Playwright MCP's `browser_navigate_back`,
// `browser_navigate_forward` and `browser_reload`.
import type { JsonSchema } from "./contracts";
import { runAction } from "./actionSequence";
import {
  requireCurrentDocument,
  validatedToolInput,
  type PublishedElementTool,
} from "./elementTools";
import { requireAymeRuntimePage } from "./registry";

const noInputSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/**
 * A tool that moves one history entry `back` or `forward`. Like any action,
 * the call answers with the Change Record once the page settles, or at once
 * when the entry is another document and its load starts. With no entry to
 * move to, the page does not move and the call's `result` says so. The
 * browser Page's own promise is never waited on: the answer follows the
 * document's navigation.
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
    execute: (input: unknown) => tool.executeAs(input, "agent"),
    executeAs: async (input, caller) => {
      validatedToolInput(noInputSchema, input);
      const currentDocument = requireCurrentDocument();
      const page = requireAymeRuntimePage();
      const traverse = () =>
        direction === "back" ? page.goBack() : page.goForward();
      const navigation = currentDocument.defaultView?.navigation;
      return runAction(
        currentDocument,
        caller,
        { tool: name, args: input },
        async () => {
          // The browser Page moves through history with the Navigation API
          // and refuses with its own error without it.
          if (!navigation) return traverse();
          const hasEntry =
            direction === "back"
              ? navigation.canGoBack
              : navigation.canGoForward;
          if (!hasEntry)
            return `There is no history entry to go ${direction} to; the page did not move.`;
          // A traversal happens in a later task. One within the document
          // commits a new current entry, or fails if it is cancelled; one to
          // another document starts a full load, which the action answers.
          const watching = new AbortController();
          const traversed = new Promise<void>((resolve) => {
            for (const type of ["currententrychange", "navigateerror"])
              navigation.addEventListener(type, () => resolve(), {
                signal: watching.signal,
              });
          }).finally(() => watching.abort());
          void traverse().catch(() => {});
          await traversed;
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
  execute: (input: unknown) => reloadTool.executeAs(input, "agent"),
  executeAs: async (input, caller) => {
    validatedToolInput(noInputSchema, input);
    const currentDocument = requireCurrentDocument();
    const page = requireAymeRuntimePage();
    return runAction(
      currentDocument,
      caller,
      { tool: "reload", args: input },
      () => {
        void page.reload().catch(() => {});
      }
    );
  },
};
