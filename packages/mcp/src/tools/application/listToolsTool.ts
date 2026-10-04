import { notConnectedResult, textResult } from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/**
 * `ayme_list_tools`: the paired page's current tools, for agents that read
 * the MCP tool list once and never see the page's tools arrive.
 */
export const listToolsTool: ServerToolFactory = ({ connection }) => ({
  name: "ayme_list_tools",
  description:
    "Lists the connected page's current tools with their name, description and input schema. Run any of them with ayme_call. Use it when the page's tools are missing from your tool list.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async call() {
    if (!connection.paired) return notConnectedResult();
    return textResult(
      JSON.stringify(
        connection.tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema: { ...inputSchema, type: "object" },
        }))
      )
    );
  },
});
