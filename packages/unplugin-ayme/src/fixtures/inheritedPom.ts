import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

class BasePom {
  readonly inheritedButton!: Locator;

  @WebMCP.tool({ description: "Use the inherited tool." })
  inheritedTool(value: string) {
    return value;
  }
}

@WebMCP
export class InheritedPom extends BasePom {
  readonly ownButton!: Locator;
}
