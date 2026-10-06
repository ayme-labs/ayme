import type { AgentConnection } from "../../connection";
import {
  notConnectedResult,
  pageToolResult,
  type ToolResult,
} from "../domain/toolResult";

/**
 * Runs the tool `name` of the page or App Process that offers it, as an MCP
 * result. A name no connection offers gets `unknown(name)` while a page is
 * paired; otherwise, or when the connection leaves before the call goes
 * out, it answers that no page is connected, since the name may be a page
 * tool the agent listed before.
 */
export async function callPageTool(
  connection: AgentConnection,
  name: string,
  input: unknown,
  unknown: (name: string) => ToolResult
): Promise<ToolResult> {
  if (!connection.offers(name))
    return connection.paired ? unknown(name) : notConnectedResult();
  let outcome;
  try {
    outcome = await connection.call(name, input);
  } catch {
    // The connection left between the check and the call.
    return notConnectedResult();
  }
  return pageToolResult(outcome);
}
