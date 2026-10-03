import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class BasePom {
  readonly inheritedButton!: Locator;
  declare readonly overriddenButton: Locator;
  private readonly basePrivateButton!: Locator;
  protected readonly baseProtectedButton!: Locator;

  @ayme.action({ description: "Use the inherited base tool." })
  inheritedTool() {}

  @ayme.action({ description: "Use the base override tool." })
  overriddenTool(value: string) {
    return value;
  }

  @ayme.action({ description: "Do not expose the private base tool." })
  private basePrivateTool() {}

  @ayme.action({ description: "Do not expose the protected base tool." })
  protected baseProtectedTool() {}
}

class MiddlePom extends BasePom {
  readonly middleButton!: Locator;
  override readonly overriddenButton: Locator = undefined as unknown as Locator;
  private readonly middlePrivateButton!: Locator;
  protected readonly middleProtectedButton!: Locator;

  @ayme.action({ description: "Use the inherited middle tool." })
  middleTool() {}

  @ayme.action({ description: "Use the middle override tool." })
  override overriddenTool(value: string) {
    return value;
  }
}

@ayme
export class MultiLevelInheritedPom extends MiddlePom {
  readonly ownButton!: Locator;
  override readonly overriddenButton: Locator = undefined as unknown as Locator;
  private readonly finalPrivateButton!: Locator;
  protected readonly finalProtectedButton!: Locator;

  @ayme.action({ description: "Use the final override tool." })
  override overriddenTool(value: string) {
    return value;
  }
}
