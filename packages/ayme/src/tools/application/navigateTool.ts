// The `navigate` Browser Tool: opens a URL on the page's own origin through
// the browser Page's `goto`, mirroring Playwright MCP's `browser_navigate`.
import type { JsonSchema } from "../../shared";
import { startNavigation } from "../../page-state/infrastructure";
import type { PublishedElementTool } from "./elementTools";
import { navigationDestination } from "../domain/navigationDestination";

/** The application's own navigation, given in runtime setup as `navigate`. */
export type RouterNavigate = (url: string) => unknown;

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
 * Package-internal: the tool that opens a URL on the page's own origin. A
 * URL on another origin is refused: the new document would not run this
 * runtime, so the connection would be lost. With a router function from
 * runtime setup, which `routerNavigate` reads when a call runs, the resolved
 * URL goes to it, so the application's router moves the page; otherwise to
 * `goto`. Like any action, the call answers with the Change Record once the
 * page settles, or at once when a full page load starts; `goto`'s own outcome
 * is never reported, since it waits for a load this document does not see
 * when a router takes the navigation over.
 */
export const navigateTool = (
  routerNavigate: () => RouterNavigate | undefined
): PublishedElementTool => ({
  name: "navigate",
  description:
    "Open a URL on the page's own origin, or a path relative to the current page.",
  inputSchema: navigateSchema,
  execute: async (input, context) => {
    const { cursor, page, document: currentDocument } = context;
    const { url } = input as { url: string };
    const destination = navigationDestination(
      url,
      currentDocument.baseURI,
      currentDocument.location.origin
    );
    // The browser Page rejects an invalid URL with its own error before it
    // navigates.
    if (!destination) await page.goto(url);
    const navigate = routerNavigate();
    return context.pageStateSession.runAction(
      cursor,
      { tool: "navigate", args: input },
      navigate
        ? async () => {
            // What the router function returns is not the action's result.
            await navigate(destination!.href);
          }
        : () =>
            // The URL the checks above passed, resolved against the
            // document's base URL.
            startNavigation(currentDocument, () => page.goto(destination!.href))
    );
  },
});
