import type { PageTool, ToolCallOutcome } from "../../contract";

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

/**
 * The Page Objects entry this server serves, while no build of it has
 * succeeded, the first error of its last build, and whether the server
 * watches for changes: the entry's files once the build started, or,
 * while it could not start, `installFiles`.
 */
export type FailedPageObjects = {
  entry: string;
  error: string;
  watching: boolean;
  /**
   * While the build could not start: the project's `package.json` and
   * lockfile, on whose change the server starts it again.
   */
  installFiles?: readonly string[];
};

/**
 * What an agent is told while no build of the served Page Objects entry
 * has succeeded: that it did not build, its first error, whether a build
 * ever succeeded, and whether the server is watching for changes.
 */
export function pageObjectsNotBuilt({
  entry,
  error,
  watching,
  installFiles,
}: FailedPageObjects) {
  const state = !watching
    ? "The server is not watching for changes: the build could not start, so no file is watched."
    : installFiles?.length
      ? `The server is watching ${installFiles.join(" and ")} for changes: it starts the build again when ${installFiles.length === 1 ? "it changes" : "either changes"}.`
      : "The server is watching for changes: it rebuilds the entry when a file it read changes.";
  return [
    `The Page Objects entry ${entry} did not build, and no build of it has succeeded, so this server serves no Page Objects. The first error: ${error}`,
    state,
  ].join("\n");
}

/**
 * The answer of a page tool or fallback tool while no page is paired, with
 * the version gap the server refused the last page for, if it did, else
 * why the served Page Objects did not build, if they did not.
 */
export function notConnectedResult(
  versionGap?: string,
  failedPageObjects?: FailedPageObjects
): ToolResult {
  if (versionGap !== undefined)
    return errorResult(`No page is connected: ${versionGap}`);
  if (failedPageObjects !== undefined)
    return errorResult(
      `No page is connected. ${pageObjectsNotBuilt(failedPageObjects)}`
    );
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
 * availability (ADR-0035). An unmarked tool gets no annotations: MCP then
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
