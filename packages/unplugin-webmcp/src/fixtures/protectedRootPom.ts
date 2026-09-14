import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

class PageObjectBase {
  protected readonly root!: Locator;
  protected readonly internalButton!: Locator;
}

@WebMCP
export class ProtectedRootPom extends PageObjectBase {
  readonly actionButton!: Locator;
}
