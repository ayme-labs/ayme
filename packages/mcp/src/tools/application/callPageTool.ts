import type { AgentConnection } from "../../connection";
import {
  notConnectedResult,
  pageToolResult,
  type ToolResult,
} from "../domain/toolResult";

/**
 * Runs the paired page's tool `name` as an MCP result. While no page is
 * paired, or when the page leaves before the call goes out, it answers that
 * no page is connected; a name the page doesn't offer gets `unknown(name)`.
 */
export async function callPageTool(
  connection: AgentConnection,
  name: string,
  input: unknown,
  unknown: (name: string) => ToolResult
): Promise<ToolResult> {
  if (!connection.paired) return notConnectedResult();
  if (!connection.tools.some((tool) => tool.name === name))
    return unknown(name);
  let outcome;
  try {
    outcome = await connection.call(name, input);
  } catch {
    // The page left between the check and the call.
    return notConnectedResult();
  }
  return pageToolResult(outcome);
}
