import type { PageTool, ToolCallOutcome } from "../../contract";
import {
  buildErrorLine,
  type SettledBuildState,
} from "../../served-page-objects";

/** An MCP tool result. */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * A thrown error as the text an agent reads: its full message, prefixed with
 * its name unless that is plain "Error" and followed by the Change Record a
 * failed action left on it, as WebMCP publication reports it.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const text =
    !error.name || error.name === "Error"
      ? error.message
      : `${error.name}: ${error.message}`;
  return text + changeRecordText(error);
}

/** The Change Record a failed action left on its error, as text to follow it. */
const changeRecordText = (error: Error) =>
  (["changes_before", "changes"] as const)
    .map((name) => {
      const part = (error as Partial<Record<typeof name, unknown>>)[name];
      return typeof part === "string" && part ? `\n\n${name}:\n${part}` : "";
    })
    .join("");

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

/** What an agent is told while no build of the served entry has succeeded. */
export function pageObjectsNotBuilt(
  state?: SettledBuildState,
  initScript?: string
): string | undefined {
  if (state === undefined) return undefined;
  let error: string;
  let watching: string;
  switch (state.kind) {
    case "cannot-start":
      error = state.error;
      watching =
        "The server is not watching for changes: the build could not start, so no file is watched.";
      break;
    case "watching-install": {
      const { installFiles } = state;
      error = state.error;
      watching = `The server is watching ${installFiles.join(" and ")} for changes: it starts the build again when ${installFiles.length === 1 ? "it changes" : "either changes"}.`;
      break;
    }
    case "never-built":
      // Deduplication leaves at least one diagnostic of a failed build.
      error = buildErrorLine(state.errors[0]!);
      watching =
        "The server is watching for changes: it rebuilds the entry when a file it read changes.";
      break;
    case "built":
    case "rebuild-failed":
      return undefined;
  }
  return [
    `The Page Objects entry ${state.entry} did not build, and no build of it has succeeded, so this server serves no Page Objects. The first error: ${error}`,
    watching,
    ...(initScript !== undefined && state.kind !== "cannot-start"
      ? [
          `Once it builds, this server serves Page Objects to pages that load ${initScript}.`,
        ]
      : []),
  ].join("\n");
}

/**
 * The answer of a page tool or fallback tool while no page is paired, with
 * the version gap the server refused the last page for, if it did, else
 * why the served Page Objects did not build, if they did not.
 */
export function notConnectedResult(
  versionGap?: string,
  state?: SettledBuildState
): ToolResult {
  if (versionGap !== undefined)
    return errorResult(`No page is connected: ${versionGap}`);
  const why = pageObjectsNotBuilt(state);
  if (why !== undefined) return errorResult(`No page is connected. ${why}`);
  return errorResult("No page is connected.");
}

/**
 * The answer to a call of a tool the page or an App Process offered earlier
 * but no longer does.
 */
export function goneToolResult(name: string): ToolResult {
  return errorResult(
    `The tool "${name}" is gone: the page or App Process that offered it no longer does.`
  );
}

/**
 * A page tool as the MCP tool list shows it: its name, description and
 * schema, and `destructiveHint` when its author marked it destructive, but
 * not its availability, since that list changes on presence and not on
 * availability (ADR-0062). An unmarked tool gets no annotations: MCP then
 * takes it as possibly destructive, and ayme never says otherwise.
 */
export function mcpPageTool({
  name,
  description,
  inputSchema,
  destructive,
}: PageTool): McpListedTool {
  const tool = {
    name,
    description,
    inputSchema: { ...inputSchema, type: "object" as const },
  };
  return destructive
    ? { ...tool, annotations: { destructiveHint: true } }
    : tool;
}

/** A tool in the MCP tool list: a page tool or one of the server's own. */
export type McpListedTool = {
  name: string;
  description: string | undefined;
  inputSchema: Record<string, unknown> & { type: "object" };
  annotations?: { destructiveHint: true };
};

/**
 * A page tool as `ayme_list_tools` shows it: the MCP listing, plus whether
 * a call can run it now and, when it cannot and the page said, why.
 */
export function listedPageTool(tool: PageTool) {
  return {
    ...mcpPageTool(tool),
    available: tool.available,
    reason: tool.reason,
  };
}
