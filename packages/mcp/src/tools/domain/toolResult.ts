import type { ToolCallOutcome } from "../../contract";

/** An MCP tool result. */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * A thrown error as the text an agent reads: its full message, prefixed with
 * its name unless that is plain "Error", as WebMCP publication reports it.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * A page tool's outcome as an MCP result: a text result passes through, and
 * any other value is its JSON text. A failure is an `isError` result.
 */
export function pageToolResult(outcome: ToolCallOutcome): ToolResult {
  if (!outcome.ok) return errorResult(outcome.error);
  const { result } = outcome;
  if (result === undefined || result === null) return textResult("null");
  if (typeof result === "string") return textResult(result);
  return textResult(JSON.stringify(result));
}

/** The answer of a page tool or fallback tool while no page is paired. */
export function notConnectedResult(): ToolResult {
  return errorResult(
    "No page is connected. Call ayme_connect with the app's URL and open the link it returns, in your browser tool or in the developer's browser."
  );
}
