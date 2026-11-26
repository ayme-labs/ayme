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
 * no build of them has succeeded, why they did not build, in one text item
 * with the link on its own line. While no page is paired, a call for the
 * page then waits a moment for the page the link opens.
 */
export const connectTool: ServerToolFactory = ({
  connection,
  pairing,
  initScript,
  pageObjectsBuildState,
}) => ({
  name: "ayme_connect",
  description:
    "Returns a link that connects a browser tab to this ayme MCP server. Open the link, in your browser tool or ask the developer to open it in theirs; the page's tools then become available as MCP tools.",
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
      const link = connectLink(url as string, pairing);
      // A call for the page waits a moment for the page this link opens.
      connection.linked();
      if (initScript === undefined) return textResult(link);
      const serving =
        pageObjectsNotBuilt(await pageObjectsBuildState(), initScript) ??
        `This server serves Page Objects to pages that load ${initScript}.`;
      // One text item, the link alone on its first line: an agent that
      // joins text items with nothing between them would run the link into
      // the next sentence.
      return textResult(`${link}\n\n${serving}`);
    } catch (error) {
      return errorResult(errorText(error));
    }
  },
});
