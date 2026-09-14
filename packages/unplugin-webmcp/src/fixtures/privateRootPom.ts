import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

class PageObjectBase {
  private readonly root!: Locator;
  private readonly internalButton!: Locator;
}

@WebMCP
export class PrivateRootPom extends PageObjectBase {
  readonly actionButton!: Locator;
}
