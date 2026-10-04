import {
  errorResult,
  notConnectedResult,
  pageToolResult,
} from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/**
 * `ayme_call`: runs a page tool by name, for agents whose tool list never
 * shows it. Its result is the one a direct call to the page tool returns.
 */
export const callTool: ServerToolFactory = ({ connection }) => ({
  name: "ayme_call",
  description:
    "Runs one of the connected page's tools by name and returns its result. ayme_list_tools lists the tools and their input schemas.",
  inputSchema: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        description: "The name of the page tool, as ayme_list_tools gives it.",
      },
      input: {
        type: "object",
        description: "The tool's input, matching its input schema.",
      },
    },
    required: ["tool"],
    additionalProperties: false,
  },
  async call({ tool, input = {} }) {
    if (!connection.paired) return notConnectedResult();
    const name = String(tool);
    if (!connection.tools.some((pageTool) => pageTool.name === name))
      return errorResult(
        `The page has no tool "${name}". Call ayme_list_tools for the page's current tools.`
      );
    let outcome;
    try {
      outcome = await connection.call(name, input);
    } catch {
      // The page left between the check and the call.
      return notConnectedResult();
    }
    return pageToolResult(outcome);
  },
});
