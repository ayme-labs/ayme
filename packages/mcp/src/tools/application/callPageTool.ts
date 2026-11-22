import type { AgentConnection } from "../../connection";
import {
  type FailedPageObjects,
  notConnectedResult,
  pageToolResult,
  type ToolResult,
} from "../domain/toolResult";

/**
 * Runs the tool `name` of the page or App Process that offers it, as an MCP
 * result. A name no connection offers gets `unknown(name)` while a page or
 * App Process is paired; otherwise, or while only an App Process is paired
 * after the server refused a page's Ayme, it answers that no page is
 * connected, and why, since the name may be a page tool the agent listed
 * before. While the served Page Objects have no good build, that answer
 * says why (`failedPageObjects`). A call for the page waits while its tab
 * loads a new document (see `AgentConnection.call`).
 */
export async function callPageTool(
  connection: AgentConnection,
  name: string,
  input: unknown,
  unknown: (name: string) => ToolResult,
  failedPageObjects: () => Promise<FailedPageObjects | undefined>
): Promise<ToolResult> {
  const outcome = await connection.call(name, input);
  if (!outcome)
    return connection.paired ||
      (connection.connected && connection.versionGap === undefined)
      ? unknown(name)
      : notConnectedResult(connection.versionGap, await failedPageObjects());
  return pageToolResult(outcome);
}
