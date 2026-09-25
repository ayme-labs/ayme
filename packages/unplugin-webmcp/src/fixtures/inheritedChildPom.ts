import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

@WebMCP
class BaseMenu {
  readonly item!: Locator;
}

class UserMenu extends BaseMenu {
  readonly signOutItem!: Locator;
}

@WebMCP
export class PageY {
  readonly heading!: Locator;
  readonly userMenu!: UserMenu;
  readonly narrowedMenu!: UserMenu & BaseMenu;
}
