import { errorResult } from "../domain/toolResult";
import { callPageTool } from "./callPageTool";
import type { ServerToolFactory } from "./serverTool";

/**
 * `ayme_call`: runs a tool of the page or an App Process by name, for agents whose tool list never
 * shows it. Its result is the one a direct call to the page tool returns.
 */
export const callTool: ServerToolFactory = ({ connection, saveImage }) => ({
  name: "ayme_call",
  description:
    "Runs one of the tools of the connected page or App Processes by name and returns its result. ayme_list_tools lists the tools and their input schemas.",
  inputSchema: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        description: "The name of the tool, as ayme_list_tools gives it.",
      },
      input: {
        type: "object",
        description: "The tool's input, matching its input schema.",
      },
    },
    required: ["tool"],
    additionalProperties: false,
  },
  call: ({ tool, input = {} }) =>
    callPageTool(
      connection,
      String(tool),
      input,
      (name) =>
        errorResult(
          `No connected page or App Process offers a tool "${name}". Call ayme_list_tools for the current tools.`
        ),
      saveImage
    ),
});
