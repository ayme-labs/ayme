/**
 * How a page left before it answered a call. `tools` is there once the tab
 * reconnected: the names of the tools the new document offers.
 */
export type PageExit =
  | {
      type: "reloaded" | "navigated";
      url: string;
      tools?: readonly string[];
    }
  | { type: "closed" }
  | { type: "replaced" }
  | { type: "stopped" };

const UNKNOWN = "so the call's outcome is unknown";

/**
 * The text the server answers a call with when its page left before
 * answering: a JSON object with `error` saying what happened, and, when the
 * page was loading a new document, `settled: false`, the URL in `loading`
 * and the reconnected page's `tools`. `next` says what to do now.
 */
export function unansweredCallText(exit: PageExit): string {
  return JSON.stringify(unansweredCall(exit));
}

function unansweredCall(exit: PageExit) {
  switch (exit.type) {
    case "closed":
      return {
        error: `The tab closed, or left the app, before it answered, ${UNKNOWN}.`,
        next: "No page is connected. Call ayme_connect and open the link to connect a tab.",
      };
    case "replaced":
      return {
        error: `Another tab connected to this server before this page answered, ${UNKNOWN}.`,
        next: "The server now works with the newest tab. Call snapshot to read it.",
      };
    case "stopped":
      return {
        error: `The Ayme MCP server stopped before the page answered, ${UNKNOWN}.`,
        next: "Restart the Ayme MCP server, then call ayme_connect and open the link.",
      };
    default: {
      const { type, url, tools } = exit;
      const what =
        type === "reloaded"
          ? tools
            ? "The page reloaded"
            : "The page started reloading"
          : tools
            ? `The page navigated to ${url}`
            : `The page started loading ${url}`;
      return {
        error: `${what} before it answered, ${UNKNOWN}.`,
        settled: false,
        loading: url,
        ...(tools ? { tools } : {}),
        next: tools
          ? "The page reconnected with the tools in `tools`. Call snapshot to read it before you call the tool again."
          : "The page has not reconnected yet. Its tools return once it has loaded; then call snapshot to read it.",
      };
    }
  }
}
