import { ayme } from "@ayme-dev/ayme";

import { WebMCP } from "./replacedWebMcp";

@ayme
export class LegacyToolPom {
  @WebMCP.tool({ description: "Open the menu." })
  open() {}
}
