/**
 * How a page or App Process left before it answered a call, or before a
 * call held for the page went out. `tools` is there once the tab
 * reconnected: the names of the tools the new document offers.
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

/** How the page left before a call held for it went out. */
export type HeldCallExit = Exclude<PageExit, { type: "processLeft" }>;

const UNKNOWN = "so the call's outcome is unknown";

/**
 * The text the server answers a call with when its page left before
 * answering: a JSON object with `error` saying what happened, and, when the
 * page was loading a new document, `settled: false`, the URL in `loading`
 * and the reconnected page's `tools`.
 */
export function unansweredCallText(exit: PageExit): string {
  return JSON.stringify(unansweredCall(exit));
}

function unansweredCall(exit: PageExit) {
  switch (exit.type) {
    case "closed":
      return {
        error: `The tab closed, or left the app, before it answered, ${UNKNOWN}.`,
      };
    case "processLeft":
      return {
        error: `The App Process exited, or lost its connection to this server, before it answered, ${UNKNOWN}.`,
      };
    case "replaced":
      return {
        error: `Another tab connected to this server before this page answered, ${UNKNOWN}.`,
      };
    case "stopped":
      return {
        error: `The Ayme MCP server stopped before the page answered, ${UNKNOWN}.`,
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
      };
    }
  }
}

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
