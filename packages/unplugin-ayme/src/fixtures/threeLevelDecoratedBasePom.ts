import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

@WebMCP
class TopPom {
  readonly topButton!: Locator;

  @WebMCP.tool({ description: "Use the top tool." })
  topTool() {}
}

class MiddlePom extends TopPom {
  readonly middleButton!: Locator;
}

export class BottomPom extends MiddlePom {
  readonly bottomButton!: Locator;

  @WebMCP.tool({ description: "Use the bottom tool." })
  bottomTool() {}
}
