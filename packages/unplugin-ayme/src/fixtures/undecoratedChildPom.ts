import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

class MenuBase {
  readonly item!: Locator;
}

class UserMenu extends MenuBase {
  readonly signOutItem!: Locator;
}

@WebMCP
export class PageX {
  readonly heading!: Locator;
  readonly userMenu!: UserMenu;
}
