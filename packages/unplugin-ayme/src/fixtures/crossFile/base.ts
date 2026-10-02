import type { Locator } from "@playwright/test";

import { WebMCP } from "../webmcp";

@WebMCP
export abstract class BaseMenu {
  readonly baseItem!: Locator;

  @WebMCP.tool({ description: "Open the menu." })
  open() {}
}
