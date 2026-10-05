// The `navigate` Browser Tool: opens a URL on the page's own origin through
// the browser Page's `goto`, mirroring Playwright MCP's `browser_navigate`.
import type { JsonSchema } from "./contracts";
import { runAction, startNavigation } from "./actionSequence";
import {
  requireCurrentDocument,
  validatedToolInput,
  type PublishedElementTool,
} from "./elementTools";
import { ToolInputError } from "./errors";
import { requireAymeRuntimePage } from "./registry";

/** The application's own navigation, given in runtime setup as `navigate`. */
type RouterNavigate = (url: string) => unknown;

type RouterStore = { navigate?: RouterNavigate };

const routerStore: RouterStore = ((
  globalThis as typeof globalThis & { __aymeRouterStore?: RouterStore }
).__aymeRouterStore ??= {});

/**
 * Package-internal: store or clear the router function for the current
 * runtime session. Called by `start()` and `stop()` in `runtime.ts`.
 */
export function configureRouterNavigate(
  navigate: RouterNavigate | undefined
): void {
  routerStore.navigate = navigate;
}

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
 * lost. With a router function from runtime setup, the resolved URL goes to
 * it, so the application's router moves the page; otherwise to `goto`. Like
 * any action, the call answers with the Change Record once the page settles,
 * or at once when a full page load starts; `goto`'s own outcome is never
 * reported, since it waits for a load this document does not see when a
 * router takes the navigation over.
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
    // Only http(s) documents run this runtime; a same-origin blob: URL
    // would pass the origin check below.
    if (destination && !["http:", "https:"].includes(destination.protocol))
      throw new ToolInputError(
        `Cannot navigate to "${url}": the protocol ${destination.protocol} is not supported.`
      );
    const { origin } = currentDocument.location;
    if (destination && destination.origin !== origin)
      throw new ToolInputError(
        `Cannot navigate to "${url}": it is not on the page's own origin, ${origin}. Leaving the origin would lose the connection to this page; navigate to a path or a URL on ${origin} instead.`
      );
    const { navigate } = routerStore;
    return runAction(
      currentDocument,
      caller,
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
};
