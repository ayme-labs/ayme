/**
 * How a page or App Process left before it answered a call. `tools` is there once the tab
 * reconnected: the names of the tools the new document offers. Without it, the
 * wait for the tab to reconnect ended and no page came back.
 */
export type PageExit =
  | {
      type: "reloaded" | "navigated";
      url: string;
      tools?: readonly string[];
    }
  | { type: "closed" }
  | { type: "processLeft" }
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
    case "processLeft":
      return {
        error: `The App Process exited, or lost its connection to this server, before it answered, ${UNKNOWN}.`,
        next: "Its tools return once it connects again. Call ayme_list_tools for the current tools.",
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
      if (!tools)
        return {
          error: `${what} before it answered, ${UNKNOWN}. No page reconnected in its place: the tab closed, or the page it loaded does not run Ayme's Agent Connection.`,
          settled: false,
          loading: url,
          next: "No page is connected.",
        };
      return {
        error: `${what} before it answered, ${UNKNOWN}.`,
        settled: false,
        loading: url,
        tools,
        next: "The page reconnected with the tools in `tools`. Call snapshot to read it before you call the tool again.",
      };
    }
  }
}

/**
 * How the page left when the server held a call for it and no page came
 * back: it started loading a new document and its tab did not reconnect,
 * its channel closed without a word and its tab did not reconnect, another
 * tab paired in its place, or the server stopped.
 */
export type HeldCallExit =
  | { type: "reloaded" | "navigated"; url: string }
  | { type: "closed" }
  | { type: "replaced" }
  | { type: "stopped" };

/**
 * The text the server answers a held call with when no page came back for
 * it: what happened, and that the call did not run.
 */
export function heldCallText(exit: HeldCallExit): string {
  switch (exit.type) {
    case "stopped":
      return "The Ayme MCP server stopped before the page reconnected, so the call did not run.";
    case "closed":
      return "The page's connection closed and its tab did not reconnect, so the call did not run.";
    case "replaced":
      return "Another tab connected to this server before the page reconnected, so the call did not run.";
    default: {
      const what =
        exit.type === "reloaded"
          ? "The page started reloading"
          : `The page started loading ${exit.url}`;
      return `${what} and no page reconnected in its place, so the call did not run: the tab closed, or the page it loaded does not run Ayme's Agent Connection.`;
    }
  }
}
