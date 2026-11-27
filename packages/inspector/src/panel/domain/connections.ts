/** The WebMCP publication status, as the runtime reports it. */
export type PublicationStatus = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;

/**
 * How a path's dot reads: `off` hollow grey, `ok` green, `warning` amber,
 * `error` red.
 */
export type Tone = "off" | "ok" | "warning" | "error";

/** WebMCP's row in the Connections popover. */
export type ConnectionRow = Readonly<{
  tone: Tone;
  /** Its state in a word or two, beside its name. */
  label: string;
  /** What that state means, or why it is so. */
  lines: readonly string[];
  /** The option that turns it on, when it is off. */
  snippet?: string;
}>;

/**
 * How many of the session's tools WebMCP publishes: every one but a Peek
 * Tool, as `@ayme-dev/webmcp` decides.
 */
export function webMcpToolCount(
  tools: readonly Readonly<{ name: string; group?: string }>[]
): number {
  return tools.filter((tool) => tool.group !== "peek").length;
}

/** WebMCP's row; `tools` is how many tools it publishes. */
export function webMcpRow(
  status: PublicationStatus,
  tools: number
): ConnectionRow {
  switch (status.state) {
    case "disabled":
      return {
        tone: "off",
        label: "Off",
        lines: ["For agents that live in this browser, such as an extension."],
        snippet: "webMCP: { enabled: true }",
      };
    case "waiting":
      return {
        tone: "ok",
        label: "On",
        lines: ["Publishing to agents in this browser once WebMCP is ready."],
      };
    case "active":
      return {
        tone: "ok",
        label: "Published",
        lines: [
          `${tools} ${tools === 1 ? "tool" : "tools"} published to agents in this browser.`,
        ],
      };
    case "unavailable":
      return {
        tone: "warning",
        label: "Unavailable",
        lines: [
          "This browser has no WebMCP. Load the WebMCP polyfill, or turn on the browser's WebMCP flag.",
        ],
      };
    case "failed":
      return { tone: "error", label: "Failed", lines: [status.message] };
    case "disposed":
      return {
        tone: "off",
        label: "Stopped",
        lines: ["No ayme runtime session is running, so nothing is published."],
      };
  }
}

/** What the header's pill says: WebMCP's state. */
export function webMcpPill(row: ConnectionRow): {
  tone: Tone;
  text: string;
  /** How the pill names itself to assistive technology. */
  label: string;
} {
  return {
    tone: row.tone,
    text: "WebMCP",
    label: `WebMCP ${row.label.toLowerCase()}`,
  };
}
