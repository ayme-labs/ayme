import { connectLink } from "../../pairing";
import {
  errorResult,
  errorText,
  pageObjectsNotBuilt,
  textResult,
} from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/**
 * `ayme_connect`: the link that pairs a tab with this server, and, while it
 * serves Page Objects, the init script a page loads them through, or, while
 * no build of them has succeeded, why they did not build.
 */
export const connectTool: ServerToolFactory = ({
  pairing,
  initScript,
  failedPageObjects,
}) => ({
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
      const link = textResult(connectLink(url as string, pairing));
      if (initScript === undefined) return link;
      const failed = await failedPageObjects();
      return {
        content: [
          ...link.content,
          {
            type: "text",
            text:
              failed === undefined
                ? `This server serves Page Objects to pages that load ${initScript}.`
                : `${pageObjectsNotBuilt(failed)}${failed.watching ? `\nOnce it builds, this server serves Page Objects to pages that load ${initScript}.` : ""}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(errorText(error));
    }
  },
});
