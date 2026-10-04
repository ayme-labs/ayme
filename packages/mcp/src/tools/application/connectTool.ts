import { connectLink } from "../../pairing";
import { errorResult, errorText, textResult } from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/** `ayme_connect`: the link that pairs a tab with this server. */
export const connectTool: ServerToolFactory = ({ pairing }) => ({
  name: "ayme_connect",
  description:
    "Returns a link that connects a browser tab to this Ayme MCP server. Open the link, in your browser tool or ask the developer to open it in theirs; the page's tools then become available as MCP tools.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL of the app page to connect, such as http://localhost:5173/.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async call({ url }) {
    try {
      return textResult(connectLink(String(url), pairing));
    } catch (error) {
      return errorResult(errorText(error));
    }
  },
});
