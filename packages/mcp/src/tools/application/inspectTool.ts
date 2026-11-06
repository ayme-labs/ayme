import { INSPECTOR_INSTALL_HINT } from "../../inspector";
import { errorResult, textResult } from "../domain/toolResult";
import type { ServerToolFactory } from "./serverTool";

/** `ayme_inspect`: the URL of the external Inspector of the connected page. */
export const inspectTool: ServerToolFactory = ({ inspector }) => ({
  name: "ayme_inspect",
  description:
    "Returns the URL of the Ayme Inspector for the connected page, served by this server. Open it in a browser window beside the app: it shows the page's Page Objects, structure, tools and Runs, highlights elements on the page and picks one, outside the page itself. It follows the page connected to this server, and works while this server runs.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async call() {
    return (await inspector.installed())
      ? textResult(inspector.url)
      : errorResult(INSPECTOR_INSTALL_HINT);
  },
});
