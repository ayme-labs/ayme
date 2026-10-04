// The `navigate` Browser Tool: opens a URL on the page's own origin through
// the browser Page's `goto`, mirroring Playwright MCP's `browser_navigate`.
import type { JsonSchema } from "./contracts";
import { runAction } from "./actionSequence";
import {
  requireCurrentDocument,
  validatedToolInput,
  type PublishedElementTool,
} from "./elementTools";
import { ToolInputError } from "./errors";
import { requireAymeRuntimePage } from "./registry";

const navigateSchema: JsonSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description:
        "The URL to open: a path relative to the current page, or a URL on the page's own origin.",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

/**
 * Open a URL on the page's own origin. A URL on another origin is refused:
 * the new document would not run this runtime, so the connection would be
 * lost. Like any action, the call answers with the Change Record once the
 * page settles, or at once when a full page load starts; `goto`'s own
 * outcome is never reported, since it waits for a load this document does
 * not see when a router takes the navigation over.
 */
export const navigateTool: PublishedElementTool = {
  name: "navigate",
  description:
    "Open a URL on the page's own origin, or a path relative to the current page.",
  inputSchema: navigateSchema,
  execute: (input: unknown) => navigateTool.executeAs(input, "agent"),
  executeAs: async (input, caller) => {
    const { url } = validatedToolInput(navigateSchema, input) as {
      url: string;
    };
    const currentDocument = requireCurrentDocument();
    const page = requireAymeRuntimePage();
    const destination = URL.parse(url, currentDocument.baseURI);
    // The browser Page rejects an invalid URL with its own error before it
    // navigates.
    if (!destination) await page.goto(url);
    const { origin } = currentDocument.location;
    if (destination && destination.origin !== origin)
      throw new ToolInputError(
        `Cannot navigate to "${url}": it is not on the page's own origin, ${origin}. Leaving the origin would lose the connection to this page; navigate to a path or a URL on ${origin} instead.`
      );
    return runAction(
      currentDocument,
      caller,
      { tool: "navigate", args: input },
      async () => {
        void page.goto(url).catch(() => {});
      }
    );
  },
};
