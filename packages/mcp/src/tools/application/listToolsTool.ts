import {
  listedPageTool,
  notConnectedResult,
  textResult,
} from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/**
 * `ayme_list_tools`: the current tools of the paired page and App
 * Processes, for agents that read the MCP tool list once and never see the
 * page's tools arrive.
 */
export const listToolsTool: ServerToolFactory = ({ connection }) => ({
  name: "ayme_list_tools",
  description:
    "Lists the current tools of the connected page and of the app's own processes (App Processes), with their name, description and input schema, whether each can run now (available) and, when it cannot, why (reason). Run any of them with ayme_call. Use it when these tools are missing from your tool list.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async call() {
    if (!connection.connected) return notConnectedResult();
    return textResult(JSON.stringify(connection.tools.map(listedPageTool)));
  },
});
