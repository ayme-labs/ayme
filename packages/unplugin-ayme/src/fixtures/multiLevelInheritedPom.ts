import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

class BasePom {
  readonly inheritedButton!: Locator;
  declare readonly overriddenButton: Locator;
  private readonly basePrivateButton!: Locator;
  protected readonly baseProtectedButton!: Locator;

  @WebMCP.tool({ description: "Use the inherited base tool." })
  inheritedTool() {}

  @WebMCP.tool({ description: "Use the base override tool." })
  overriddenTool(value: string) {
    return value;
  }

  @WebMCP.tool({ description: "Do not expose the private base tool." })
  private basePrivateTool() {}

  @WebMCP.tool({ description: "Do not expose the protected base tool." })
  protected baseProtectedTool() {}
}

class MiddlePom extends BasePom {
  readonly middleButton!: Locator;
  override readonly overriddenButton: Locator = undefined as unknown as Locator;
  private readonly middlePrivateButton!: Locator;
  protected readonly middleProtectedButton!: Locator;

  @WebMCP.tool({ description: "Use the inherited middle tool." })
  middleTool() {}

  @WebMCP.tool({ description: "Use the middle override tool." })
  override overriddenTool(value: string) {
    return value;
  }
}

@WebMCP
export class MultiLevelInheritedPom extends MiddlePom {
  readonly ownButton!: Locator;
  override readonly overriddenButton: Locator = undefined as unknown as Locator;
  private readonly finalPrivateButton!: Locator;
  protected readonly finalProtectedButton!: Locator;

  @WebMCP.tool({ description: "Use the final override tool." })
  override overriddenTool(value: string) {
    return value;
  }
}
